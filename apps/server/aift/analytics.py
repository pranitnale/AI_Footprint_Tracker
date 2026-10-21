import base64
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, localcontext
from functools import wraps
from uuid import UUID
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from dateutil.relativedelta import relativedelta
from footprint_contracts import (
    ContractError,
    claude_factor_for,
    claude_text_components,
    claude_token_fields,
    counts_as_request,
    payload_hash,
    validate_observation,
)
from sqlalchemy import delete, distinct, func, select
from sqlalchemy.orm import aliased

from . import dto, method_registry
from .db import (
    DailyRollup,
    DeletionScope,
    DeletionTombstone,
    EnrollmentEra,
    Observation,
    RequestAttemptLink,
    get,
    put,
)
from .file_text import (
    FILE_COVERAGE_FIELDS,
    request_disclosure,
)
from .file_text import (
    count_fields as series_count_fields,
)
from .file_text import (
    coverage as file_coverage,
)
from .file_text import (
    projections as file_projections,
)
from .method_history import MethodHistory, select_records
from .policies import capture_policy_valid, usage_retention
from .security import Problem, canonical, connection_ip, digest, instant, parse_time, uid


def exact_decimal(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        with localcontext() as context:
            context.prec = 80
            return function(*args, **kwargs)

    return wrapped


def quantity_string(value, modern=False):
    number = Decimal(value)
    if modern:
        import math

        result = str(number).lower()
        if not number.is_finite() or number < 0 or not math.isfinite(float(number)) or len(result) > 96:
            raise Problem("quantity_overflow", 503)
        return result
    if not number.is_finite() or number < 0 or number >= Decimal("1e38"):
        raise Problem("quantity_overflow", 503)
    result = format(number, "f")
    result = result.rstrip("0").rstrip(".") if "." in result else result
    if len(result.replace(".", "").lstrip("0")) > 38 or ("." in result and len(result.split(".")[1]) > 18):
        raise Problem("quantity_overflow", 503)
    return result


def finalize_series_value(series):
    """Serialize accumulated totals. Scenario sums follow the midpoint sum: absent when nothing contributed."""
    modern = series.get("method_group", {}).get("effective_method", {}).get("engine_id") == "ecologits"
    contributing = series.get("contributing_component_count", series.get("contributing_attempt_count", 0))
    series["value"] = quantity_string(series["value"], modern) if contributing else None
    if series.get("value_kind") == "midpoint_sum":
        for field in ("scenario_low", "scenario_high"):
            endpoint = series.get(field)
            series[field] = quantity_string(endpoint, modern) if contributing and endpoint is not None else None


def add_scenario_sums(target, series, sign=1):
    """Add one contribution's scenario sums. A contribution saved without them (an older rollup)
    leaves the group's scenario totals unavailable rather than partially summed."""
    if target.get("scenario_low") is None or series.get("scenario_low") is None:
        target["scenario_low"] = target["scenario_high"] = None
        return
    target["scenario_low"] = Decimal(target["scenario_low"]) + sign * Decimal(series["scenario_low"])
    target["scenario_high"] = Decimal(target["scenario_high"]) + sign * Decimal(series["scenario_high"])


UNFINISHED_ATTEMPT_STATES = {"dispatched", "generating"}
FINISHED_ATTEMPT_STATES = {"completed", "cancelled", "failed", "interrupted_unconfirmed"}


def provisional_attempt_key(kind, stored, record, stable):
    """Whether a later revision of a live reply may replace the provider key stored for it.

    Until 14 Oct 2026 the extension named a ChatGPT reply that thought first by its thoughts
    while it streamed and by its answer once the answer came, and this server refused every
    revision after the first that carried a key, so it kept the figures of the reply's first
    thoughts. A key stored from an unfinished revision may therefore be replaced once, by the
    reply's finished revision. The caller has already checked that the revision comes from the
    installation that sent the stored one; the parent request, the start time and a company key
    stay checked as before. Every other key change stays an immutable_identity conflict.
    """
    return (
        kind == "attempt"
        and stable is not None
        and stored.get("state") in UNFINISHED_ATTEMPT_STATES
        and record.get("state") in FINISHED_ATTEMPT_STATES
    )


class Analytics:
    def __init__(self, service):
        self.service = service
        from .deletions import Deletions

        self.deletions = Deletions(self)
        from .historical_usage import HistoricalUsage

        self.history = HistoricalUsage(self)
        from .admin_queries import AdminQueries

        self.admin_queries = AdminQueries(self)
        from .exports import Exports

        self.exports = Exports(self)
        self.methods = MethodHistory(self)
        from .thread_relations import ThreadRelations

        self.thread_relations = ThreadRelations(self)
        from .company_dedup import CompanyDedup

        self.company = CompanyDedup(self)
        self.signer = Ed25519PrivateKey.from_private_bytes(
            base64.urlsafe_b64decode(service.settings.deletion_signing_key + "==")
        )

    def __call__(self, s, ctx, path, body, query, company, member, device):
        if ctx["method"] == "GET" and self.summary_path(path):
            from .history_matching import read_memo

            # A summary only reads. One read memo covers the whole request, so the status of an
            # estimation choice and the recalculated view it selects share their checks.
            with read_memo(s):
                return self.route(s, ctx, path, body, query, company, member, device)
        return self.route(s, ctx, path, body, query, company, member, device)

    @staticmethod
    def summary_path(path):
        return path in {"/v1/me/summary", "/v1/company/summary", "/v1/admin/summary", "/v1/admin/activity"} or (
            path.startswith(("/v1/me/conversations/", "/v1/me/history/")) and path.endswith("/summary")
        )

    def route(self, s, ctx, path, body, query, company, member, device):
        method = ctx["method"]
        if path == "/v1/me/estimation-selection":
            from .engine_selection import handle_selection

            return handle_selection(self, s, company, member, device, method, body, query)
        if (
            method == "GET"
            and device
            and path.startswith("/v1/me/")
            and (path.endswith("/summary") or path == "/v1/me/history/export")
            and "calculation_view" not in query
            and "method_id" not in query
        ):
            selection = device.data.get("estimation_selection")
            if selection:
                from .engine_selection import handle_selection

                status = handle_selection(self, s, company, member, device, "GET", {}, {})
                if status["recalculation"]["status"] != "completed":
                    raise Problem("recalculation_pending", 409, True)
                query = {**query, "calculation_view": "recalculated", "method_id": selection["method_id"]}
        if path == "/v1/me/method-updates" or path.startswith("/v1/me/method-updates/"):
            from .method_registry import delivery, delivery_inventory

            if method != "GET" or query or body:
                raise Problem("invalid_payload", 422)
            if not device:
                raise Problem("installation_required", 403)
            if path == "/v1/me/method-updates":
                return delivery_inventory(s, self.service.settings.method_public_key)
            return delivery(
                s,
                path.removeprefix("/v1/me/method-updates/"),
                self.service.settings.method_public_key,
                self.service.now(),
            )
        if path == "/v1/me/history" and method == "POST":
            return self.history.ingest(s, company, member, device, body, query)
        if path == "/v1/me/history/export" and method == "GET":
            return self.history.export_page(s, company, member, device, query)
        if path.startswith("/v1/me/history/") and path.endswith("/summary") and method == "GET":
            if (
                len(path.split("/")) != 6
                or set(query) - {"period", "calculation_view", "method_id"}
                or query.get("period", "all") != "all"
            ):
                raise Problem("unsupported_filter", 422)
            if not device:
                raise Problem("installation_required", 403)
            from .history_matching import read_memo

            self.methods.prepare_view(s, company, member, query, personal=True)
            with read_memo(s):
                return {
                    "history": self.history.summary(s, company, member.id, path.split("/")[-2], query=query),
                    "deletion_epoch": company.data["epoch"],
                }
        if path == "/v1/me/thread-relations" and method == "POST":
            return self.thread_relations.link(s, company, member, device, body, query)
        if path.startswith("/v1/me/recorded-threads/") and path.endswith("/summary") and method == "GET":
            if len(path.split("/")) != 6:
                raise Problem("not_found", 404)
            return self.thread_relations.summary(s, company, member, device, path.split("/")[-2], query)
        if path == "/v1/methods" and method == "GET":
            return method_registry.inventory(s)
        for prefix, personal in (("/v1/me/recalculations", True), ("/v1/admin/recalculations", False)):
            if path == prefix and method == "POST":
                return self.methods.create(s, company, member, body, personal=personal)
            if path.startswith(prefix + "/") and method == "GET":
                return self.methods.status(s, company, member, path.split("/")[-1], personal=personal)

        if path == "/v1/usage/batches" and method == "POST":
            if not device:
                raise Problem("installation_required", 403)
            return self.ingest(s, ctx, company, member, device, body)
        if path.startswith("/v1/usage/records/") and method == "GET":
            from .method_history import resolve_estimate

            if set(query) - {"calculation_view", "method_id"}:
                raise Problem("unsupported_filter", 422)
            kind, record_id = path.split("/")[-2:]
            row = s.get(Observation, (company.id, member.id, kind, record_id))
            if not row:
                raise Problem("not_found", 404)
            parent = s.get(Observation, (company.id, member.id, "request", row.parent)) if row.parent else row
            if not parent or self.erased(s, company, member.id, parent.occurred_at, kind, record_id):
                raise Problem("erased", 404)
            cutoff = self.cutoff(s, company)
            if cutoff and parent.occurred_at < cutoff:
                raise Problem("retention_expired", 404)
            view = self.methods.prepare_view(s, company, member, query, personal=True)
            return {
                "record": row.payload,
                "payload_hash": row.payload_hash,
                "server_record_version": row.revision,
                "estimate": resolve_estimate(s, row, view.get("method_id")),
                "request_attempt_links": [
                    {"request_id": link.request_id, "attempt_id": link.attempt_id, "reason": link.reason}
                    for link in s.scalars(
                        select(RequestAttemptLink)
                        .where(
                            RequestAttemptLink.tenant == company.id,
                            RequestAttemptLink.owner == member.id,
                            (RequestAttemptLink.request_id == record_id)
                            if kind == "request"
                            else (RequestAttemptLink.attempt_id == record_id),
                        )
                        .limit(200)
                    )
                ],
            }
        if path in {"/v1/me/summary", "/v1/company/summary", "/v1/admin/summary"} or (
            path.startswith("/v1/me/conversations/") and path.endswith("/summary")
        ):
            if method != "GET":
                raise Problem("not_found", 404)
            from .history_matching import read_memo

            # With person analytics off administrators see organization totals only, never one
            # person's (owner decision of 18 October 2026), so the server refuses the filter.
            if path == "/v1/admin/summary":
                self.service.refuse_person_filter(query)
            conversation = path.split("/")[-2] if "/conversations/" in path else None
            # splits=none returns the same summary without its day, tool and model splits, which
            # cost most of the time and size. A page that shows no chart asks for it.
            with_splits = True
            if "splits" in query:
                if conversation or query["splits"] != "none":
                    raise Problem("unsupported_filter", 422)
                query = {k: v for k, v in query.items() if k != "splits"}
                with_splits = False
            # A summary only reads, and its splits ask about the same saved messages again.
            with read_memo(s):
                result = self.summary(
                    s,
                    company,
                    member,
                    query,
                    personal=path.startswith("/v1/me/"),
                    private=path == "/v1/company/summary",
                    conversation=conversation,
                )
                if result.get("aggregate_status") == "current":
                    person = None if path.startswith("/v1/me/") else query.get("user_id")
                    result["history"] = self.history.summary(
                        s,
                        company,
                        member.id if path.startswith("/v1/me/") else person,
                        conversation,
                        query,
                        since=self.person_floor(s, company)[0] if person else None,
                    )
                if (
                    with_splits
                    and path == "/v1/company/summary"
                    and result.get("aggregate_status") == "current"
                    and not result.get("suppressed")
                ):
                    result.update(self.splits(s, company, member, query, result))
                # One person's administrator summary splits that person's figures only.
                if with_splits and path == "/v1/admin/summary" and result.get("aggregate_status") == "current":
                    result.update(
                        self.splits(s, company, member, query, result, private=False, owner=query.get("user_id"))
                    )
            return result
        if path == "/v1/admin/activity":
            if method != "GET":
                raise Problem("not_found", 404)
            return self.activity(s, company, member, query)
        if path == "/v1/deletions/changes" and method == "GET":
            if set(query) - {"last_epoch"}:
                raise Problem("unsupported_filter", 422)
            try:
                epoch = int(query.get("last_epoch", 0))
            except ValueError:
                raise Problem("invalid_epoch", 422) from None
            return {
                **self.deletions.change_page(s, company, member.id, epoch),
                "retention_cutoff": self.cutoff(s, company),
            }
        if path.startswith("/v1/admin/network") or path == "/v1/admin/requests" or (
            path.startswith("/v1/admin/users/") and "/requests/" in path
        ):
            # The Network page lists addresses next to members and browsers, so it needs both
            # switches; the request list and request details need person analytics. Off, these
            # endpoints do not exist (owner decision of 18 October 2026).
            self.service.require_person_analytics()
            if path.startswith("/v1/admin/network") and not self.service.settings.ip_collection_enabled:
                raise Problem("not_found", 404)
        if path == "/v1/admin/network/access" and method == "POST":
            from .service import NETWORK_VIEW_SECONDS

            data = dto.NetworkAccess.model_validate_json(canonical(body)).model_dump(mode="json")
            self.service.reauth(s, company, member, data["reauth_token"])
            session = ctx["session"]
            until = self.service.expires(NETWORK_VIEW_SECONDS)
            session.data = {**session.data, "network_until": until}
            return {"expires_at": until}
        if path == "/v1/admin/network" and method == "GET":
            # The addresses open only after a fresh email code on this session (POST .../access).
            until = ctx["session"].data.get("network_until")
            if not until or not self.service.alive(until):
                raise Problem("reauthentication_required", 403)
            return self.network(s, company, member, query)
        if path == "/v1/admin/requests" and method == "GET":
            return self.admin_queries.requests(s, company, query)
        if path == "/v1/admin/breakdown" and method == "GET":
            self.service.refuse_person_filter(query)
            return self.admin_queries.breakdown(s, company, query)
        if path == "/v1/admin/people" and method == "GET":
            self.service.refuse_person_filter(query)
            return self.admin_queries.people(s, company, query)
        if path.startswith("/v1/admin/users/") and "/requests/" in path and method == "GET":
            pieces = path.split("/")
            if len(pieces) != 7:
                raise Problem("not_found", 404)
            return self.admin_queries.detail(s, company, pieces[4], pieces[6], query)
        if path == "/v1/admin/deletions/preview" and method == "POST":
            return self.preview(s, company, member, body)
        if path.startswith("/v1/admin/deletions/previews/") and (
            method == "GET" or method == "POST" and path.endswith("/advance")
        ):
            row = get(s, "deletion_preview", path.split("/")[5], company.id)
            if not row or row.owner != member.id:
                raise Problem("not_found", 404)
            if method == "POST":
                if body:
                    raise Problem("invalid_payload", 422)
                self.deletions.advance_preview(s, company, row)
            return self.deletions.preview_result(row, s, company)
        if path == "/v1/admin/deletions" and method == "POST":
            return self.erase(s, company, member, body)
        if path.startswith("/v1/admin/deletions/") and method == "GET":
            job = get(s, "deletion_job", path.rsplit("/", 1)[-1], company.id)
            if not job:
                raise Problem("not_found", 404)
            return self.deletions.job_result(s, company, job)
        if path.startswith("/v1/admin/deletions/") and path.endswith("/advance") and method == "POST":
            if body:
                raise Problem("invalid_payload", 422)
            job = get(s, "deletion_job", path.split("/")[4], company.id)
            if not job:
                raise Problem("not_found", 404)
            self.deletions.advance(s, company, job)
            return self.deletions.job_result(s, company, job)
        if path == "/v1/admin/exports" and method == "POST":
            return self.export(s, company, member, body)
        if path.startswith("/v1/admin/exports/") and (
            method == "GET" or method == "POST" and path.endswith("/advance")
        ):
            pieces = path.split("/")
            job = get(s, "export", pieces[4], company.id)
            # Only the administrator who created an export (with a fresh email code) reads it. Its id
            # is in the audit log every administrator sees, so the id alone must not open it.
            if not job or job.owner != member.id or not self.exports.eligible(s, company, job):
                raise Problem("export_unavailable", 404)
            if method == "POST":
                if body:
                    raise Problem("invalid_payload", 422)
                self.exports.advance(s, company, job)
            if pieces[-1] == "download":
                if job.data["status"] != "completed":
                    raise Problem("export_pending", 409, True)
                return {
                    "_export_stream": {"company_id": company.id, "job_id": job.id, "actor_id": member.id},
                    "_export_length": job.data["byte_length"],
                    "_export_integrity": job.data["integrity_chain"],
                }
            return self.exports.result(job)
        if path == "/v1/admin/plan-transition/acknowledge" and method == "POST":
            data = dto.TransitionAck.model_validate_json(canonical(body)).model_dump(mode="json")
            operation, request_hash, prior = self.service.admin_operation(
                s, company, member, "transition_ack", data
            )
            if prior:
                return prior
            row = get(s, "transition", data["transition_id"], company.id)
            if not row or row.data["version"] != data["expected_version"]:
                raise Problem("stale_version", 409)
            if self.service.transition_state(row) != "pending":
                raise Problem(
                    "transition_terminal"
                    if self.service.transition_state(row) in {"applied", "cancelled", "superseded"}
                    else "transition_review_required",
                    409,
                )
            if not self.service.transition_valid(company, row):
                raise Problem("transition_review_required", 409)
            # Acknowledging confirms a shorter retention that deletes older usage, so it needs a
            # fresh email code like a policy change.
            self.service.reauth(s, company, member, data["reauth_token"])
            row.data = {
                **row.data,
                "acknowledged": True,
                "version": row.data["version"] + 1,
                "acknowledged_by": member.id,
                "acknowledged_at": instant(self.service.now()),
            }
            self.service.audit(s, company.id, member.id, "retention_transition_acknowledged", row.id)
            return self.service.remember_operation(
                s, company, member, operation, request_hash, {"acknowledged": True, "transition_id": row.id}
            )
        raise Problem("not_found", 404)

    def cutoff(self, s, company, persist=False):
        from .history_matching import retention_row

        months = usage_retention(company.data)
        stored = get(s, "retention", company.id, company.id) if persist else retention_row(s, company.id)
        current = stored.data["cutoff"] if stored else None
        if months:
            local = (
                self.service.now()
                .astimezone(ZoneInfo(company.data["timezone"]))
                .replace(hour=0, minute=0, second=0, microsecond=0)
            )
            candidate = instant((local - relativedelta(months=months)).astimezone(UTC))
            current = max(filter(None, [current, candidate]))
        if persist and current:
            put(s, "retention", company.id, {"cutoff": current}, company.id)
        return current

    def erased(self, s, company, owner, request_time, kind, record_id):
        if s.get(DeletionTombstone, (company.id, owner, kind, record_id)):
            return True
        return (
            s.scalar(
                select(DeletionScope.id)
                .where(
                    DeletionScope.tenant == company.id,
                    (DeletionScope.deletion_user_id.is_(None) | (DeletionScope.deletion_user_id == owner)),
                    (
                        (DeletionScope.scope == "user")
                        | (
                            (DeletionScope.range_start <= request_time)
                            & (DeletionScope.range_end > request_time)
                        )
                    ),
                )
                .limit(1)
            )
            is not None
        )

    def estimate(self, record, session, request=None, *, tenant=None, owner=None):
        if record["kind"] == "request":
            return {"status": "not_applicable"}
        method_registry.retain_packaged_definition(
            session, record.get("proposed_method_id"), self.service.now()
        )
        try:
            return {
                "status": "available",
                "result": method_registry.estimate(
                    session, record, request=request, tenant=tenant, owner=owner
                ),
            }
        except Problem as error:
            if error.code not in {"method_unsupported", "engine_unavailable", "estimation_input_unavailable"}:
                raise
            return {
                "status": "pending",
                "reason": error.code,
                "retry_count": 0,
                "queued_at": instant(self.service.now()),
            }

    def ingest(self, s, ctx, company, member, device, body):
        if company.data.get("aggregate_status") == "rebuilding":
            raise Problem("aggregate_rebuilding", 409, True)
        try:
            dto.UsageEnvelope.model_validate_json(canonical(body))
            parse_time(body["sent_at"])
            for record in body["records"]:
                if (
                    record.get("kind") not in {"request", "attempt"}
                    or type(record.get("revision")) is not int
                    or not 1 <= record["revision"] <= 2147483647
                ):
                    raise ValueError
                UUID(record["request_id"] if record["kind"] == "request" else record["attempt_id"])
        except (ContractError, ValueError, TypeError, KeyError):
            raise Problem("invalid_observation", 422) from None

        def identity(record):
            return (record["kind"], record["request_id"] if record["kind"] == "request" else record["attempt_id"])

        # Company keys travel beside the records, one per record at most (W11).
        keys = self.company.key_entries(
            company,
            body.get("company_dedup_keys"),
            {identity(record) for record in body["records"]},
            lambda entry: (entry["kind"], entry["record_id"]),
        )
        self.service.rate(s, "upload:" + device.id, 120, 60)
        if body["deletion_epoch"] != company.data["epoch"]:
            raise Problem("deletion_sync_required", 409)
        results = []
        accepted = 0
        for record in body["records"]:
            try:
                validate_observation(record)
            except (ContractError, ValueError, TypeError, KeyError):
                results.append(
                    {
                        "kind": record["kind"],
                        "record_id": record["request_id"]
                        if record["kind"] == "request"
                        else record["attempt_id"],
                        "revision": record["revision"],
                        "canonical_id": None,
                        "payload_hash": None,
                        "status": "rejected",
                        "error_code": "invalid_observation",
                        "retryable": False,
                        "server_record_version": None,
                        "estimate_status": "unavailable",
                    }
                )
                continue
            with s.begin_nested():
                result = self.ingest_record(s, company, member, device, record, keys.get(identity(record)))
            results.append(result)
            accepted += result["status"] in {"applied", "stored_pending_estimate"}
        # Connection addresses are stored only while the operator has IP collection switched on
        # (owner decision of 18 October 2026); off, no address is read or written.
        if self.service.settings.ip_collection_enabled:
            from .ip_rotation import check_write_key

            check_write_key(s, self.service)
            receipt = uid()
            address = connection_ip(ctx["peer"], ctx.get("forwarded"), self.service.settings.trusted_proxy_cidrs)
            put(
                s,
                "network",
                receipt,
                {
                    "observed_at": instant(self.service.now()),
                    "device_id": device.id,
                    "address": self.service.secrets.encrypt_ip(address) if address else None,
                    "equality": self.service.secrets.keyed("ip:" + company.id, address, ip=True)
                    if address
                    else None,
                    "key_version": self.service.secrets.active_ip_key_version,
                    "source_quality": "server_observed" if address else "ip_unresolved",
                    "accepted_record_count": accepted,
                },
                company.id,
                member.id,
            )
        if accepted:
            device.data = {**device.data, "last_reporting_at": instant(self.service.now())}
        days = {
            parse_time(record.get("dispatched_at", record.get("started_at")))
            .astimezone(ZoneInfo(company.data["timezone"]))
            .date()
            .isoformat()
            for record, result in zip(body["records"], results)
            if result["status"] in {"aliased", "conflict"}
            and record.get("dispatched_at", record.get("started_at"))
        }
        for day in days:
            self.rebuild_day(s, company, member, day)
        return {
            "batch_id": body["batch_id"],
            "server_time": instant(self.service.now()),
            "deletion_epoch": company.data["epoch"],
            "results": results,
        }

    @exact_decimal
    def contribution_delta(self, s, company, member, record, sign):
        """Update one fixed-size observation contribution, without reading earlier day records."""
        # Another member's copy counts a shared record in period and company totals (W11).
        if record.status == "aliased" or record.company_shared:
            return
        day = parse_time(record.occurred_at).astimezone(ZoneInfo(company.data["timezone"])).date().isoformat()
        end = (datetime.strptime(day, "%Y-%m-%d") + timedelta(days=1)).date().isoformat()
        fragment = self._canonical_summary(
            s,
            company,
            member,
            {"start": day, "end": end},
            personal=True,
            records_override=[record],
            with_disclosures=True,
        )
        fragment = {
            key: value
            for key, value in fragment.items()
            if key not in {"snapshot_id", "generated_at", "retention_cutoff"}
        }
        key = digest(canonical([company.id, member.id, day, record.site, record.model]))
        row = get(s, "rollup", key, company.id)
        if row is None:
            if sign < 0:
                raise Problem("aggregate_inconsistent", 503, True)
            value = fragment
        else:
            import copy

            value = copy.deepcopy(row.data["value"])
            if "file_text_coverage" not in value or "file_text_disclosure" not in value:
                raise Problem("aggregate_rebuilding", 409, True)
            target_presence = value["file_text_disclosure"]
            added_presence = fragment["file_text_disclosure"]
            target_presence["component_request_count"] += sign * added_presence["component_request_count"]
            if target_presence["component_request_count"] < 0:
                raise Problem("aggregate_inconsistent", 503, True)
            for group, count in added_presence["group_request_counts"].items():
                updated = target_presence["group_request_counts"].get(group, 0) + sign * count
                if updated < 0:
                    raise Problem("aggregate_inconsistent", 503, True)
                if updated:
                    target_presence["group_request_counts"][group] = updated
                else:
                    target_presence["group_request_counts"].pop(group, None)
            for field in FILE_COVERAGE_FIELDS:
                updated = int(value["file_text_coverage"][field]) + sign * int(
                    fragment["file_text_coverage"][field]
                )
                if updated < 0:
                    raise Problem("aggregate_inconsistent", 503, True)
                value["file_text_coverage"][field] = str(updated)
            for field in (
                "request_count",
                "attempt_count",
                "unconfirmed_attempt_count",
                "unresolved_request_count",
                "pending_estimates",
                "observed_search_operations",
                "search_known_request_count",
                "search_unknown_request_count",
            ):
                updated = int(value[field]) + sign * int(fragment[field])
                if updated < 0:
                    raise Problem("aggregate_inconsistent", 503, True)
                value[field] = str(updated)
            for state, count in fragment["outcomes"].items():
                value["outcomes"][state] = str(int(value["outcomes"].get(state, 0)) + sign * int(count))
            for field in ("recorded_attempts", "resource_applicable_count", "resource_unknown_count"):
                value["coverage"][field] = str(
                    int(value["coverage"][field]) + sign * int(fragment["coverage"][field])
                )
            for category in ("tokens", "resources", "media_counts", "image_references", "file_text"):

                def series_key(series):
                    return canonical(
                        [
                            series["quantity"],
                            series["scope"],
                            series["unit"],
                            series.get("method_group"),
                            series.get("measurement_group"),
                        ]
                    )

                series_map = {series_key(series): series for series in value[category]}
                for addition in fragment[category]:
                    series_id = series_key(addition)
                    target = series_map.get(series_id)
                    if target is None:
                        if sign < 0:
                            raise Problem("aggregate_inconsistent", 503, True)
                        series_map[series_id] = addition
                        continue
                    missing_counts = (
                        target.setdefault("missing_counts", {}) if "missing_counts" in addition else {}
                    )
                    for reason, count in addition.get("missing_counts", {}).items():
                        updated = missing_counts.get(reason, 0) + sign * count
                        if updated < 0:
                            raise Problem("aggregate_inconsistent", 503, True)
                        if updated:
                            missing_counts[reason] = updated
                        else:
                            missing_counts.pop(reason, None)
                    reason_counts = target.setdefault("reason_counts", {})
                    for reason, count in addition.get("reason_counts", {}).items():
                        updated = reason_counts.get(reason, 0) + sign * count
                        if updated < 0:
                            raise Problem("aggregate_inconsistent", 503, True)
                        if updated:
                            reason_counts[reason] = updated
                        else:
                            reason_counts.pop(reason, None)
                    amount = Decimal(target["value"] or "0") + sign * Decimal(addition["value"] or "0")
                    if addition.get("value_kind") == "midpoint_sum" and addition["value"] is not None:
                        add_scenario_sums(target, addition, sign)
                    for field in series_count_fields(addition):
                        target[field] += sign * addition[field]
                        if target[field] < 0:
                            raise Problem("aggregate_inconsistent", 503, True)
                    if amount < 0 or any(
                        isinstance(target.get(field), Decimal) and target[field] < 0
                        for field in ("scenario_low", "scenario_high")
                    ):
                        raise Problem("aggregate_inconsistent", 503, True)
                    target["value"] = amount
                    finalize_series_value(target)
                    if not target["applicable_count"]:
                        series_map.pop(series_id)
                value[category] = list(series_map.values())
            value["method_groups"] = sorted({r["method_group"]["method_id"] for r in value["resources"]})
            value["mixed_methods"] = len(value["method_groups"]) > 1
        # Per-range distinct populations are queried from canonical identifiers, not incremented here.
        value["active_users"] = "1" if int(value["request_count"]) else "0"
        value["active_installations"] = "0"
        put(
            s,
            "rollup",
            key,
            {
                "day": day,
                "site": record.site,
                "model": record.model,
                "timezone": company.data["timezone"],
                "status": "current",
                "value": value,
                "checksum": digest(canonical(value)),
                "rebuilt_at": instant(self.service.now()),
            },
            company.id,
            member.id,
        )

    def day_value(self, s, company, member, day, site=None, model=None, include_expired=False):
        end = (datetime.strptime(day, "%Y-%m-%d") + timedelta(days=1)).date().isoformat()
        filters = {"start": day, "end": end}
        if site:
            filters.update(site=site, model=model or "__unknown__")
        result = self._canonical_summary(
            s, company, member, filters, personal=True, include_expired=include_expired, with_disclosures=True
        )
        result["active_installations"] = "0"
        return {
            key: value
            for key, value in result.items()
            if key not in {"snapshot_id", "generated_at", "retention_cutoff"}
        }

    def rebuild_day(self, s, company, member, day, include_expired=False):
        end = (datetime.strptime(day, "%Y-%m-%d") + timedelta(days=1)).date().isoformat()
        start_utc, end_utc = self.bounds(company, {"start": day, "end": end})
        dimensions = s.execute(
            select(Observation.site, Observation.model)
            .where(
                Observation.tenant == company.id,
                Observation.owner == member.id,
                Observation.occurred_at >= start_utc,
                Observation.occurred_at < end_utc,
            )
            .distinct()
        ).all()
        s.execute(
            delete(DailyRollup).where(
                DailyRollup.tenant == company.id, DailyRollup.owner == member.id, DailyRollup.day == day
            )
        )
        for site, model in dimensions:
            value = self.day_value(s, company, member, day, site, model, include_expired=include_expired)
            put(
                s,
                "rollup",
                digest(canonical([company.id, member.id, day, site, model])),
                {
                    "day": day,
                    "site": site,
                    "model": model,
                    "timezone": company.data["timezone"],
                    "status": "current",
                    "value": value,
                    "checksum": digest(canonical(value)),
                    "rebuilt_at": instant(self.service.now()),
                },
                company.id,
                member.id,
            )

    def ingest_record(self, s, company, member, device, record, company_key=None):
        kind = record["kind"]
        record_id = record["request_id"] if kind == "request" else record["attempt_id"]
        hashed = payload_hash(record)
        ack = {
            "kind": kind,
            "record_id": record_id,
            "revision": record["revision"],
            "canonical_id": record_id,
            "payload_hash": hashed,
            "status": "applied",
            "error_code": None,
            "retryable": False,
            "server_record_version": record["revision"],
            "estimate_status": "not_applicable",
        }

        def reject(code, status="rejected", retryable=False):
            return {**ack, "status": status, "error_code": code, "retryable": retryable}

        old = s.get(Observation, (company.id, member.id, kind, record_id))
        if (
            old
            and kind == "attempt"
            and (old.payload.get("proposed_method_id") or method_registry.BASELINE_METHOD_ID)
            != (record.get("proposed_method_id") or method_registry.BASELINE_METHOD_ID)
        ):
            return reject("method_conflict", "conflict")
        parent = None
        occurrence = record["dispatched_at"] if kind == "request" else record["started_at"]
        if s.get(DeletionTombstone, (company.id, member.id, kind, record_id)):
            return reject("erased", "erased")
        existing_alias = get(s, "alias", digest(company.id + member.id + kind + record_id), company.id)
        if existing_alias and s.get(
            DeletionTombstone, (company.id, member.id, kind, existing_alias.data["canonical_id"])
        ):
            return reject("erased", "erased")
        stable = record.get("provider_request_key" if kind == "request" else "provider_attempt_key")
        if stable and s.scalar(
            select(DeletionTombstone.record_id)
            .where(
                DeletionTombstone.tenant == company.id,
                DeletionTombstone.owner == member.id,
                DeletionTombstone.kind == kind,
                DeletionTombstone.stable_key == stable,
            )
            .limit(1)
        ):
            return reject("erased", "erased")
        if old:
            old_parent = (
                s.get(Observation, (company.id, member.id, "request", old.parent)) if old.parent else None
            )
            if self.erased(
                s,
                company,
                member.id,
                old_parent.occurred_at if old_parent else old.occurred_at,
                kind,
                record_id,
            ):
                return reject("erased", "erased")
        if parse_time(occurrence) > self.service.now() + timedelta(minutes=5):
            return reject("clock_skew")
        for timestamp in (record.get("ended_at"),):
            if timestamp and (
                parse_time(timestamp) < parse_time(occurrence)
                or parse_time(timestamp) > self.service.now() + timedelta(minutes=5)
            ):
                return reject("clock_skew")
        if kind == "attempt":
            parent_id = record["request_id"]
            alias = get(s, "alias", digest(company.id + member.id + "request" + parent_id), company.id)
            if alias:
                parent_id = alias.data["canonical_id"]
            parent = s.get(Observation, (company.id, member.id, "request", parent_id))
            if not parent:
                return reject("dependency_missing", retryable=True)
            if parent.device != device.id and not (old and old.device == device.id):
                proven_duplicate = (
                    s.scalar(
                        select(Observation).where(
                            Observation.tenant == company.id,
                            Observation.owner == member.id,
                            Observation.kind == "attempt",
                            Observation.stable_key == record.get("provider_attempt_key"),
                        )
                    )
                    if record.get("provider_attempt_key")
                    else None
                )
                if not proven_duplicate:
                    return reject("ownership_conflict", "conflict")
        dispatched = parent.occurred_at if parent else occurrence
        if self.erased(s, company, member.id, dispatched, kind, record_id):
            return reject("erased", "erased")
        cutoff = self.cutoff(s, company)
        if cutoff and dispatched < cutoff:
            return reject("retention_expired", "retention_expired")
        eras = list(
            s.scalars(
                select(EnrollmentEra).where(
                    EnrollmentEra.tenant == company.id,
                    EnrollmentEra.device_id == device.id,
                    EnrollmentEra.started_at <= dispatched,
                    (EnrollmentEra.ended_at.is_(None) | (EnrollmentEra.ended_at > dispatched)),
                )
            )
        )
        if not any(
            r.data["start"] <= dispatched and (r.data["end"] is None or dispatched < r.data["end"])
            for r in eras
        ):
            return reject("outside_enrollment_era")
        if kind == "request" and not capture_policy_valid(
            s, company, device, record["policy_version"], dispatched
        ):
            return reject("policy_mismatch")
        receipt_key = digest(company.id + member.id + kind + record_id + ":" + str(record["revision"]))
        prior = get(s, "receipt", receipt_key, company.id)
        if prior:
            if prior.data["payload_hash"] != hashed:
                return reject("revision_conflict", "conflict")
            # A retry naming another company key contradicts the recorded one (W11).
            if company_key and old and old.company_key and old.company_key != company_key:
                return reject("immutable_identity", "conflict")
            if old and old.revision > record["revision"]:
                return {**reject("stale_revision", "stale"), "server_record_version": old.revision}
            if prior.data["status"] == "aliased" or (old and old.status == "aliased"):
                canonical_id = prior.data["canonical_id"]
                seen = set()
                while canonical_id not in seen and len(seen) < 32:
                    seen.add(canonical_id)
                    alias = get(s, "alias", digest(company.id + member.id + kind + canonical_id), company.id)
                    if not alias:
                        break
                    canonical_id = alias.data["canonical_id"]
                canonical = s.get(Observation, (company.id, member.id, kind, canonical_id))
                if not canonical or canonical.status == "aliased":
                    return reject("dependency_missing", retryable=True)
                return {
                    **prior.data,
                    "status": "aliased",
                    "canonical_id": canonical.id,
                    "server_record_version": canonical.revision,
                }
            return {
                **prior.data,
                "status": "duplicate"
                if prior.data["status"] in {"applied", "stored_pending_estimate"}
                else prior.data["status"],
            }
        if old:
            if old.device != device.id:
                return reject("ownership_conflict", "conflict")
            old_stable = old.payload.get(
                "provider_request_key" if kind == "request" else "provider_attempt_key"
            )
            if (
                old_stable is not None
                and old_stable != stable
                and not provisional_attempt_key(kind, old.payload, record, stable)
            ):
                return reject("immutable_identity", "conflict")
            # A company key names the prompt or reply itself, so it never changes (W11).
            if company_key and old.company_key and old.company_key != company_key:
                return reject("immutable_identity", "conflict")
            ack["server_record_version"] = old.revision
            if record["revision"] < old.revision:
                return reject("stale_revision", "stale")
            if record["revision"] == old.revision:
                return reject("revision_conflict", "conflict")
            if kind == "request" and record["site"] != old.site:
                return reject("immutable_identity", "conflict")
            if occurrence != old.occurred_at or (kind == "attempt" and old.parent != parent.id):
                return reject("immutable_identity", "conflict")
            if old.payload["state"] in {"completed", "cancelled", "failed"} and record["state"] in {
                "dispatched",
                "dispatch_only",
                "generating",
            }:
                return reject("invalid_state_transition", "conflict")
        stable = record.get("provider_request_key" if kind == "request" else "provider_attempt_key")
        cross_user = (
            s.scalar(
                select(Observation).where(
                    Observation.tenant == company.id,
                    Observation.owner != member.id,
                    Observation.kind == kind,
                    Observation.stable_key == stable,
                )
            )
            if stable
            else None
        )
        if cross_user:
            return reject("ownership_conflict", "conflict")
        duplicate = (
            s.scalar(
                select(Observation).where(
                    Observation.tenant == company.id,
                    Observation.owner == member.id,
                    Observation.kind == kind,
                    Observation.stable_key == stable,
                )
            )
            if stable
            else None
        )
        if duplicate and duplicate.id != record_id:
            original_parent = (
                s.get(Observation, (company.id, member.id, "request", duplicate.parent))
                if kind == "attempt"
                else None
            )
            if kind == "attempt" and (
                duplicate.site != parent.site
                or (
                    duplicate.model is not None
                    and record["model_id"] is not None
                    and duplicate.model != record["model_id"]
                )
            ):
                return reject("identity_conflict", "conflict")
            if kind == "attempt" and duplicate.conversation != parent.conversation:
                # Per-request provisional keys differ for distinct dispatches in one unresolved thread.
                provisional_dispatches = (
                    original_parent is not None
                    and parent.site == original_parent.site == "perplexity"
                    and all(
                        "conversation_identity_local_only" in candidate.payload["coverage_reasons"]
                        for candidate in (parent, original_parent)
                    )
                )
                if not provisional_dispatches:
                    return reject("identity_conflict", "conflict")
            if kind == "attempt" and duplicate.parent != parent.id:
                original_parent = s.get(Observation, (company.id, member.id, "request", duplicate.parent))
                if (
                    original_parent
                    and parent.stable_key
                    and original_parent.stable_key
                    and parent.stable_key != original_parent.stable_key
                ):
                    key = (company.id, member.id, parent.id, duplicate.id)
                    if not s.get(RequestAttemptLink, key):
                        s.add(
                            RequestAttemptLink(
                                tenant=company.id,
                                owner=member.id,
                                request_id=parent.id,
                                attempt_id=duplicate.id,
                                reason="distinct_verified_dispatch",
                            )
                        )
                else:
                    if parent.status != "request_identity_ambiguous":
                        self.contribution_delta(s, company, member, parent, -1)
                        parent.status = "request_identity_ambiguous"
                        self.contribution_delta(s, company, member, parent, 1)
                    return reject("request_identity_ambiguous", "conflict")
            if kind == "request" and (
                duplicate.payload["conversation_key"] != record["conversation_key"]
                or duplicate.payload["site"] != record["site"]
            ):
                return reject("identity_conflict", "conflict")
            from .live_aliases import retain_alias

            canonical = retain_alias(
                self,
                s,
                company,
                member,
                device,
                record,
                parent,
                old,
                duplicate,
                hashed,
                receipt_key,
                allow_promotion=kind == "attempt" and duplicate.parent == parent.id,
            )
            # Every copy carries the reply's company key; the election decides which counts.
            if company_key:
                for row in (canonical, duplicate, s.get(Observation, (company.id, member.id, kind, record_id))):
                    if row is not None and row.company_key is None:
                        row.company_key = company_key
            self.company.elect(s, company, canonical.company_key)
            ack = {
                **ack,
                "status": "aliased" if canonical.id != record_id else "applied",
                "canonical_id": canonical.id,
                "server_record_version": canonical.revision,
                "estimate_status": canonical.estimate["status"],
            }
            put(s, "receipt", receipt_key, ack, company.id, member.id)
            return ack
        estimated = self.estimate(
            record, s, parent.payload if parent else None, tenant=company.id, owner=member.id
        )
        dependent_attempts = None
        if old and kind == "request":
            dependent_attempts = (
                select(Observation)
                .where(
                    Observation.tenant == company.id,
                    Observation.owner == member.id,
                    Observation.kind == "attempt",
                    Observation.parent == old.id,
                )
                .execution_options(yield_per=100)
            )
            for dependent in select_records(s, s.scalars(dependent_attempts)):
                self.contribution_delta(s, company, member, dependent, -1)
        if old:
            self.contribution_delta(s, company, member, next(select_records(s, [old])), -1)
            old.revision, old.payload_hash, old.payload, old.estimate, old.stable_key = (
                record["revision"],
                hashed,
                record,
                estimated,
                stable,
            )
            old.model = record["model_id"]
            if kind == "request" and old.conversation != record["conversation_key"]:
                from sqlalchemy import update

                old.conversation = record["conversation_key"]
                s.execute(
                    update(Observation)
                    .where(
                        Observation.tenant == company.id,
                        Observation.owner == member.id,
                        Observation.kind == "attempt",
                        Observation.parent == old.id,
                    )
                    .values(conversation=old.conversation)
                )
        else:
            old = Observation(
                tenant=company.id,
                owner=member.id,
                kind=kind,
                id=record_id,
                device=device.id,
                revision=record["revision"],
                parent=parent.id if parent else None,
                parent_kind="request" if parent else None,
                stable_key=stable,
                payload_hash=hashed,
                occurred_at=occurrence,
                payload=record,
                estimate=estimated,
                status="current",
                site=parent.site if parent else record["site"],
                model=record["model_id"],
                conversation=parent.conversation if parent else record["conversation_key"],
            )
            s.add(old)
        if company_key and old.company_key is None:
            old.company_key = company_key
        # Whether another member's copy counts is decided before this contribution is added.
        self.company.elect(s, company, old.company_key, pending=old)
        self.contribution_delta(s, company, member, old, 1)
        if dependent_attempts is not None:
            for dependent in select_records(s, s.scalars(dependent_attempts)):
                self.contribution_delta(s, company, member, dependent, 1)
        ack = {
            **ack,
            "server_record_version": record["revision"],
            "estimate_status": estimated["status"],
            "status": "stored_pending_estimate" if estimated["status"] == "pending" else "applied",
        }
        put(
            s,
            "revision",
            receipt_key,
            {
                "record": record,
                "estimate": estimated,
                "payload_hash": hashed,
                "kind": kind,
                "record_id": record_id,
            },
            company.id,
            member.id,
        )
        put(s, "receipt", receipt_key, ack, company.id, member.id)
        return ack

    def bounds(self, company, query):
        allowed = {"start", "end", "period", "site", "model", "limit", "cursor", "user_id"}
        if set(query) - allowed:
            raise Problem("unsupported_filter", 422)
        zone = ZoneInfo(company.data["timezone"])
        now = self.service.now().astimezone(zone)
        end = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        period = query.get("period", "month")
        if period not in {"week", "month", "all", "custom"}:
            raise Problem("invalid_period", 422)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start = start - timedelta(days=start.weekday()) if period == "week" else start.replace(day=1)
        if period == "all":
            start = datetime(1970, 1, 1, tzinfo=zone)
        try:
            if query.get("start"):
                start = datetime.strptime(query["start"], "%Y-%m-%d").replace(tzinfo=zone)
            if query.get("end"):
                end = datetime.strptime(query["end"], "%Y-%m-%d").replace(tzinfo=zone)
        except ValueError:
            raise Problem("invalid_date_range", 422) from None
        if start >= end:
            raise Problem("invalid_date_range", 422)
        return instant(start.astimezone(UTC)), instant(end.astimezone(UTC))

    def selected(self, s, company, query, owner=None, conversation=None, include_expired=False, since=None):
        start, end = self.bounds(company, query)
        cutoff = None if include_expired else self.cutoff(s, company)
        parent = aliased(Observation)
        statement = select(Observation).where(
            Observation.tenant == company.id,
            Observation.status != "aliased",
            Observation.occurred_at >= start,
            Observation.occurred_at < end,
            *([Observation.occurred_at >= since] if since else []),
        )
        if owner:
            statement = statement.where(Observation.owner == owner)
        if query.get("site"):
            if query["site"] not in {"chatgpt", "claude", "gemini", "perplexity", "notebooklm"}:
                raise Problem("unsupported_filter", 422)
            statement = statement.where(Observation.site == query["site"])
        if conversation:
            statement = statement.where(Observation.conversation == conversation)
        else:
            # A record another member's copy counts stays in conversation views only (W11).
            statement = statement.where(Observation.company_shared.is_(False))
        if query.get("model"):
            statement = statement.where(
                Observation.model.is_(None)
                if query["model"] == "__unknown__"
                else Observation.model == query["model"]
            )
        statement = statement.outerjoin(
            parent,
            (parent.tenant == Observation.tenant)
            & (parent.owner == Observation.owner)
            & (parent.kind == "request")
            & (parent.id == Observation.parent),
        ).where(
            (
                (Observation.kind == "request")
                & (Observation.occurred_at >= (cutoff or "1970-01-01T00:00:00.000Z"))
            )
            | (
                (Observation.kind == "attempt")
                & (parent.occurred_at >= (cutoff or "1970-01-01T00:00:00.000Z"))
            )
        )
        return start, end, s.scalars(statement.execution_options(yield_per=200)), {}

    def active_users(self, s, company, first, last, owner, site, model):
        """
        summary()'s count of distinct people with active rollups, or None outside a read memo, where
        summary() asks the database. Inside one, the (day, person, tool, model) of a period's
        active rollups are read once and the summary and each of its splits count theirs here with
        the same conditions; day strings are of one width, so text order is date order.
        """
        from .history_matching import remembering

        if not remembering(s):
            return None
        r = DailyRollup
        rows = self._period_read(
            s,
            ("active rollups", company.id, owner),
            first,
            last,
            lambda lo, hi: select(r.day, r.owner, r.site, r.model)
            .where(
                r.tenant == company.id,
                r.day >= lo,
                r.day < hi,
                r.active_observation_count > 0,
                *([r.owner == owner] if owner else []),
            )
            .distinct(),
        )
        return len(
            {
                person
                for day, person, row_site, row_model in rows
                if first <= day < last
                and person is not None
                and (not site or row_site == site)
                and (not model or row_model == model)
            }
        )

    def active_installations(self, s, company, start, end, owner, site, model):
        """summary()'s count of distinct installations with current requests, read like
        active_users; instants are of one width, so text order is time order."""
        from .history_matching import remembering

        if not remembering(s):
            return None
        o = Observation
        rows = self._period_read(
            s,
            ("active installations", company.id, owner),
            start,
            end,
            lambda lo, hi: select(o.occurred_at, o.device, o.site, o.model)
            .where(
                o.tenant == company.id,
                o.kind == "request",
                o.status == "current",
                o.company_shared.is_(False),
                o.occurred_at >= lo,
                o.occurred_at < hi,
                *([o.owner == owner] if owner else []),
            )
            .distinct(),
        )
        return len(
            {
                device
                for occurred_at, device, row_site, row_model in rows
                if start <= occurred_at < end
                and device is not None
                and (not site or row_site == site)
                and (not model or row_model == model)
            }
        )

    def period_rollups(self, s, company, first, last, owner, site, model):
        """
        summary()'s daily rollups, or None outside a read memo, where summary() asks the database.
        Inside one, the period's rollups are read and decoded once, and the summary and each of
        its day, tool and model splits take theirs from that read with the same conditions, in the
        order of that read. Before 15 October 2026 every split read and decoded its rollups again.
        """
        from .history_matching import remembering

        if not remembering(s):
            return None
        r = DailyRollup
        rows = self._period_read(
            s,
            ("rollups", company.id, owner),
            first,
            last,
            lambda lo, hi: select(r).where(
                r.tenant == company.id, r.day >= lo, r.day < hi, *([r.owner == owner] if owner else [])
            ),
        )
        return [
            rollup
            for (rollup,) in rows
            if first <= rollup.day < last
            and (not site or rollup.site == site)
            and (not model or rollup.model == model)
        ]

    @staticmethod
    def rollup_series(s, rollup):
        """
        A rollup's token, resource, media, image reference and document series, each with the key
        that groups it in a summary. A summary with its splits adds every rollup to about four
        parts, so a read memo keeps the keys, which take a JSON encoding each, once per request.
        """
        from .history_matching import remembered

        def keyed():
            value = rollup.data["value"]
            return [
                [
                    (
                        canonical(
                            [
                                series["quantity"],
                                series["unit"],
                                series["scope"],
                                series.get("method_group"),
                                series.get("measurement_group"),
                            ]
                        ),
                        series,
                    )
                    for series in collection
                ]
                for collection in (
                    value["tokens"],
                    value["resources"],
                    value.get("media_counts", []),
                    value.get("image_references", []),
                    value.get("file_text", []),
                )
            ]

        return remembered(s, ("rollup series", rollup.tenant, rollup.id), keyed)

    @staticmethod
    def _period_read(s, key, start, end, statement):
        """The rows statement(start, end) returns, from a remembered read of a period that holds
        [start, end) when there is one. The caller filters them to its own range."""
        from .history_matching import remembered

        periods = remembered(s, key, list)
        for lo, hi, rows in periods:
            if lo <= start and end <= hi:
                return rows
        rows = [tuple(row) for row in s.execute(statement(start, end))]
        periods.append((start, end, rows))
        return rows

    @exact_decimal
    def splits(self, s, company, member, query, whole, private=True, owner=None):
        """
        The organization summary split by day, tool and model, for the dashboard's charts. Each part
        is a complete summary plus its saved-history part. Members see these splits whatever the
        group size (owner decision of 13 October 2026), so a part may show one person's usage.
        With an owner (administrators only, while person analytics is on), every part is that
        person's, from the first full day after person analytics was switched on.
        """
        base = {k: v for k, v in query.items() if k not in {"site", "model", "user_id"}}
        floor = None
        if owner:
            base["user_id"] = owner
            floor = self.person_floor(s, company)

        def part(extra, model=False):
            value = self.summary(s, company, member, {**base, **extra}, private=private, split_model=model and private)
            if value.get("aggregate_status") != "current" or value.get("suppressed"):
                return None
            value["history"] = self.history.summary(
                s, company, owner, None, {**base, **extra}, since=floor[0] if floor else None
            )
            # An unused tool or day comes back as zeros; leave it out of the charts.
            if value.get("request_count") == "0" and value["history"].get("status") == "empty":
                return None
            return value

        out = {"sites": {}}
        for site in ("chatgpt", "claude", "gemini", "perplexity", "notebooklm"):
            value = part({"site": site})
            if value:
                out["sites"][site] = value
        zone = ZoneInfo(company.data["timezone"])
        first = parse_time(whole["range_start"]).astimezone(zone).date()
        last = parse_time(whole["range_end"]).astimezone(zone).date()
        if whole.get("retention_cutoff"):
            first = max(first, parse_time(whole["retention_cutoff"]).astimezone(zone).date())
        if floor:
            first = max(first, date.fromisoformat(floor[1]))
        # Daily parts only for windows a chart can show; an all-time view would be hundreds of reads.
        if 0 < (last - first).days <= 62:
            out["days"] = {}
            day = first
            while day < last:
                value = part({"period": "custom", "start": day.isoformat(), "end": (day + timedelta(days=1)).isoformat()})
                if value:
                    out["days"][day.isoformat()] = value
                day += timedelta(days=1)
        conditions = [
            DailyRollup.tenant == company.id,
            DailyRollup.day >= first.isoformat(),
            DailyRollup.day < last.isoformat(),
            DailyRollup.active_observation_count > 0,
            *([DailyRollup.owner == owner] if owner else []),
        ]
        used = [
            row
            for row in s.execute(
                select(DailyRollup.model, DailyRollup.site, func.sum(DailyRollup.active_observation_count))
                .where(*conditions)
                .group_by(DailyRollup.model, DailyRollup.site)
            )
        ]
        models = {}
        for model in sorted({row[0] for row in used if row[0]}):
            value = part({"model": model}, model=True)
            if value:
                sites = [row for row in used if row[0] == model]
                value["site"] = max(sites, key=lambda row: row[2])[1]
                models[model] = value
        if models:
            out["models"] = models
        return out

    def summary(
        self, s, company, member, query, personal=False, private=False, conversation=None, split_model=False
    ):
        view = self.methods.prepare_view(s, company, member, query, personal=personal, private=private)
        query = {k: v for k, v in query.items() if k not in {"calculation_view", "method_id"}}
        if view["calculation_view"] == "recalculated":
            original = self.summary(s, company, member, query, personal, private, conversation, split_model)
            if original.get("suppressed") or original.get("aggregate_status") != "current":
                return {**original, **view}
            result = self._canonical_summary(
                s,
                company,
                member,
                query,
                personal,
                private,
                conversation,
                method_id=view["method_id"],
                split_model=split_model,
            )
            return {**result, **view}
        if self.deletions.in_progress(s, company):
            return {
                "aggregate_status": "rebuilding",
                "safe_message": "Deletion is being applied. Totals will be available when the database work completes.",
            }
        if company.data.get("aggregate_status") == "rebuilding":
            return {
                "aggregate_status": "rebuilding",
                "safe_message": "Totals are being rebuilt for the new company timezone.",
            }
        if conversation:
            return self._canonical_summary(
                s, company, member, query, personal=True, conversation=conversation
            )
        # Organization views take no model filter from a caller; only the model split asks for one.
        if (personal or private) and "user_id" in query or private and "model" in query and not split_model:
            raise Problem("unsupported_filter", 422)
        start, end = self.bounds(company, query)
        if query.get("site") and query["site"] not in {"chatgpt", "claude", "gemini", "perplexity", "notebooklm"}:
            raise Problem("unsupported_filter", 422)
        zone = ZoneInfo(company.data["timezone"])
        first, last = (parse_time(value).astimezone(zone).date().isoformat() for value in (start, end))
        cutoff = self.cutoff(s, company)
        if cutoff:
            first = max(first, parse_time(cutoff).astimezone(zone).date().isoformat())
        owner = member.id if personal else query.get("user_id")
        person_since = None
        if owner and not personal:
            # One person's figures for an administrator start on the first full day after person
            # analytics was switched on; usage recorded while it was off is never shown by name.
            person_since, floor_day = self.person_floor(s, company)
            first = max(first, floor_day)
        conditions = [DailyRollup.tenant == company.id, DailyRollup.day >= first, DailyRollup.day < last]
        if owner:
            conditions.append(DailyRollup.owner == owner)
        if query.get("site"):
            conditions.append(DailyRollup.site == query["site"])
        if query.get("model"):
            conditions.append(DailyRollup.model == query["model"])
        snapshot = {
            "snapshot_id": uid(),
            "generated_at": instant(self.service.now()),
            "range_start": start,
            "range_end": end,
            "timezone": company.data["timezone"],
            "time_basis": {"requests": "dispatch", "attempts": "attempt_start"},
            "calculation_view": "original",
            "aggregate_status": "current",
            "retention_cutoff": cutoff,
            **({"person_analytics_since": person_since} if person_since else {}),
        }
        # With sharing on, members see organization totals whatever the group size, and a range
        # without usage is a current summary of zeros (owner decision of 13 October 2026).
        if private and company.data["company_sharing"] == "disabled":
            return {**snapshot, "aggregate_status": "policy_disabled", "suppressed": True}
        totals = {
            key: 0
            for key in (
                "request_count",
                "attempt_count",
                "unconfirmed_attempt_count",
                "unresolved_request_count",
                "pending_estimates",
                "observed_search_operations",
                "search_known_request_count",
                "search_unknown_request_count",
            )
        }
        outcomes, token_series, resource_series, methods = {}, {}, {}, set()
        media_series, image_series, file_series = {}, {}, {}
        files_coverage = {name: 0 for name in FILE_COVERAGE_FIELDS}
        unknown_resources = 0
        rollups = self.period_rollups(s, company, first, last, owner, query.get("site"), query.get("model"))
        if rollups is None:
            rollups = s.scalars(select(DailyRollup).where(*conditions).execution_options(yield_per=200))
        for rollup in rollups:
            if rollup.status != "current" or rollup.data["timezone"] != company.data["timezone"]:
                return {
                    **snapshot,
                    "aggregate_status": "rebuilding",
                    "safe_message": "Company totals are being rebuilt.",
                }
            value = rollup.data["value"]
            if "file_text_coverage" not in value or "file_text_disclosure" not in value:
                return {
                    **snapshot,
                    "aggregate_status": "rebuilding",
                    "safe_message": "Document text coverage is being rebuilt.",
                }
            for name in FILE_COVERAGE_FIELDS:
                files_coverage[name] += int(value["file_text_coverage"][name])
            for key in totals:
                totals[key] += int(value.get(key, 0))
            unknown_resources += int(value["coverage"].get("resource_unknown_count", 0))
            for key, count in value["outcomes"].items():
                outcomes[key] = outcomes.get(key, 0) + int(count)
            methods.update(value["method_groups"])
            for keyed, destination in zip(
                self.rollup_series(s, rollup),
                (token_series, resource_series, media_series, image_series, file_series),
            ):
                for key, series in keyed:
                    if key not in destination:
                        destination[key] = {
                            **series,
                            "reason_counts": {},
                            **({"missing_counts": {}} if "missing_counts" in series else {}),
                            "value": Decimal(0),
                            **(
                                {"scenario_low": Decimal(0), "scenario_high": Decimal(0)}
                                if series.get("value_kind") == "midpoint_sum"
                                else {}
                            ),
                            **{field: 0 for field in series_count_fields(series)},
                        }
                    target = destination[key]
                    for reason, count in series.get("missing_counts", {}).items():
                        target["missing_counts"][reason] = target["missing_counts"].get(reason, 0) + count
                    for reason, count in series.get("reason_counts", {}).items():
                        target["reason_counts"][reason] = target["reason_counts"].get(reason, 0) + count
                    if series["value"] is not None:
                        target["value"] += Decimal(series["value"])
                        if series.get("value_kind") == "midpoint_sum":
                            add_scenario_sums(target, series)
                    for field in series_count_fields(series):
                        target[field] += series[field]
        for series in [
            *token_series.values(),
            *resource_series.values(),
            *media_series.values(),
            *image_series.values(),
            *file_series.values(),
        ]:
            finalize_series_value(series)
        # Distinct populations are computed over the full range, never summed from daily counts.
        users = self.active_users(s, company, first, last, owner, query.get("site"), query.get("model"))
        if users is None:
            users = s.scalar(
                select(func.count(distinct(DailyRollup.owner))).where(
                    *conditions, DailyRollup.active_observation_count > 0
                )
            )
        devices = self.active_installations(
            s, company, max(start, cutoff or start), end, owner, query.get("site"), query.get("model")
        )
        if devices is None:
            device_conditions = [
                Observation.tenant == company.id,
                Observation.kind == "request",
                Observation.status == "current",
                Observation.company_shared.is_(False),
                Observation.occurred_at >= max(start, cutoff or start),
                Observation.occurred_at < end,
            ]
            if owner:
                device_conditions.append(Observation.owner == owner)
            if query.get("site"):
                device_conditions.append(Observation.site == query["site"])
            if query.get("model"):
                device_conditions.append(Observation.model == query["model"])
            devices = s.scalar(select(func.count(distinct(Observation.device))).where(*device_conditions))
        return {
            **snapshot,
            "suppressed": False,
            **{key: str(value) for key, value in totals.items()},
            "active_users": str(users),
            "active_installations": str(devices),
            "outcomes": {key: str(value) for key, value in outcomes.items()},
            "tokens": list(token_series.values()),
            "resources": list(resource_series.values()),
            "media_counts": list(media_series.values()),
            "image_references": list(image_series.values()),
            "file_text": list(file_series.values()),
            "file_text_coverage": {
                **{k: str(v) for k, v in files_coverage.items()},
                "scope": "extracted_file_text",
                "additive": False,
            },
            "method_groups": sorted(methods),
            "mixed_methods": len(methods) > 1,
            "coverage": {
                "recorded_attempts": str(totals["attempt_count"]),
                "resource_applicable_count": str(totals["attempt_count"]),
                "resource_unknown_count": str(unknown_resources),
                "unknown_is_zero": False,
                "reference_only_excluded": True,
                "resource_scope": "available compatible operational components only",
            },
        }

    @exact_decimal
    def _canonical_summary(
        self,
        s,
        company,
        member,
        query,
        personal=False,
        private=False,
        conversation=None,
        records_override=None,
        include_expired=False,
        method_id=None,
        with_disclosures=False,
        split_model=False,
    ):
        if "user_id" in query and (personal or private):
            raise Problem("unsupported_filter", 422)
        if private and "model" in query and not split_model:
            raise Problem("unsupported_filter", 422)
        if private and company.data["company_sharing"] == "disabled":
            return {
                "aggregate_status": "policy_disabled",
                "suppressed": True,
                "safe_message": "Company totals are not shared with members.",
            }
        owner = member.id if personal else query.get("user_id")
        # As in summary(): one person's figures for an administrator start after the switch.
        person_since = self.person_floor(s, company)[0] if owner and not personal else None
        if records_override is None:
            start, end, records, parents = self.selected(
                s, company, query, owner, conversation, include_expired=include_expired, since=person_since
            )
            records = select_records(s, records, method_id)
        else:
            start, end = self.bounds(company, query)
            records = records_override
        snapshot = {
            "snapshot_id": uid(),
            "generated_at": instant(self.service.now()),
            "range_start": start,
            "range_end": end,
            "timezone": company.data["timezone"],
            "time_basis": {"requests": "dispatch", "attempts": "attempt_start"},
            "calculation_view": "original",
            "aggregate_status": "current",
            "retention_cutoff": self.cutoff(s, company),
            **({"person_analytics_since": person_since} if person_since else {}),
        }
        request_count = attempt_count = unresolved_count = unconfirmed_count = pending_count = (
            unknown_count
        ) = 0
        users, devices, outcomes = set(), set(), {}
        search_count = search_known = search_unknown = 0
        tokens = {}
        resources = {}
        media_counts, image_references, files = {}, {}, {}
        file_presence = {"component_request_count": 0, "group_request_counts": {}}
        files_coverage = {name: 0 for name in FILE_COVERAGE_FIELDS}
        methods = set()
        # Token figures carry the packaged Claude token factor, as the extension's do.
        from .engine_adapter import packaged_claude_token_factor

        claude_factor = packaged_claude_token_factor()

        def media_value(collection, quantity, value, unit, scope, group, reasons=(), reference=False):
            key = canonical([quantity, unit, scope, group])
            series = collection.setdefault(
                key,
                {
                    "quantity": quantity,
                    "unit": unit,
                    "scope": scope,
                    "method_group": group,
                    "reference_only": reference,
                    "value": Decimal(0),
                    "applicable_count": 0,
                    "unknown_count": 0,
                    "partial_count": 0,
                    "unvalidated_count": 0,
                    "contributing_attempt_count": 0,
                    "reason_counts": {},
                },
            )
            series["applicable_count"] += 1
            if value is None:
                series["unknown_count"] += 1
            else:
                series["value"] += Decimal(value)
                series["contributing_attempt_count"] += 1
            if reference:
                series["partial_count"] += value is not None
                series["unvalidated_count"] += 1
            for reason in set(reasons):
                series["reason_counts"][reason] = series["reason_counts"].get(reason, 0) + 1

        for record in records:
            if record.status == "aliased":
                continue
            if record.kind == "request":
                # Read aloud adds speech energy through its attempt, never a request (G1).
                if not counts_as_request(record.payload):
                    continue
                if record.status == "current":
                    request_count += 1
                    presence = request_disclosure(record.payload)
                    file_presence["component_request_count"] += presence["component_request_count"]
                    for group, count in presence["group_request_counts"].items():
                        file_presence["group_request_counts"][group] = (
                            file_presence["group_request_counts"].get(group, 0) + count
                        )
                    scoped_coverage = file_coverage(record.payload)
                    for name in FILE_COVERAGE_FIELDS:
                        files_coverage[name] += int(scoped_coverage[name])
                    request_factor = claude_factor_for(record.site, record.payload.get("model_id"), claude_factor)
                    for key, extraction in file_projections(record.payload, request_factor):
                        target = files.get(key)
                        if target is None:
                            files[key] = extraction
                        else:
                            target["value"] += extraction["value"]
                            for name in series_count_fields(extraction):
                                target[name] += extraction[name]
                            for category in ("reason_counts", "missing_counts"):
                                for reason, count in extraction[category].items():
                                    target[category][reason] = target[category].get(reason, 0) + count
                    for operation in record.payload["media"]["requested_operations"]:
                        group = {"operation_kind": operation["kind"]}
                        media_value(
                            media_counts,
                            "image_requested_operations",
                            "1",
                            "operations",
                            "observed_request",
                            group,
                        )
                        media_value(
                            media_counts,
                            "image_requested_outputs",
                            operation["requested_count"],
                            "images",
                            "observed_request",
                            group,
                        )
                    observed_search = record.payload["observed_search_operations"]
                    if observed_search is None:
                        search_unknown += 1
                    else:
                        search_known += 1
                        search_count += int(observed_search)
                    users.add(record.owner)
                    devices.add(record.device)
                    state = record.payload["state"]
                    outcomes[state] = outcomes.get(state, 0) + 1
                else:
                    unresolved_count += 1
                continue
            for operation in record.payload["media"]["image_operations"]:
                group = {
                    "operation_kind": operation["kind"],
                    "execution_evidence": operation["execution_evidence"],
                }
                if operation["execution_evidence"] != "none":
                    media_value(
                        media_counts,
                        "image_executed_operations",
                        "1",
                        "operations",
                        "observed_generation",
                        group,
                    )
                media_value(
                    media_counts,
                    "image_returned_outputs",
                    operation["returned_count"],
                    "images",
                    "provider_reported_outputs",
                    group,
                )
            for artifact in record.payload["media"]["generated_images"]:
                media_value(
                    media_counts,
                    "image_observed_artifacts",
                    artifact["count"],
                    "images",
                    "observed_output_artifacts",
                    {"dimension_source": artifact["dimension_source"]},
                )
            if record.payload["execution_evidence"] == "none":
                unconfirmed_count += 1
                continue
            attempt_count += 1
            pending_count += record.estimate["status"] == "pending"
            unknown_count += not record.estimate.get("result")
            # Output of other models in a reply (side calls, research agents, storyboards) is
            # generated output outside the reply's own total; the synced "Out" adds it (D3).
            # Claude text counts carry the Claude token factor, part by part (claudeTokenFields).
            measurements = list(
                claude_token_fields(
                    record.payload["tokens"],
                    claude_factor_for(record.site, record.payload.get("model_id"), claude_factor),
                ).items()
            ) + [
                ("other_model_output", component["tokens"])
                for component in claude_text_components(
                    record.site, record.payload.get("generation", {}).get("text_components", []), claude_factor
                )
            ]
            for field, measured in measurements:
                if not isinstance(measured, dict) or "value" not in measured:
                    continue
                # A field that does not apply (no uploaded images) is neither known nor unknown.
                if measured["evidence"] == "not_applicable":
                    continue
                measurement_group = {"evidence": measured["evidence"], "profile_id": measured["profile_id"]}
                key = field + ":" + measured["scope"] + ":" + canonical(measurement_group)
                series = tokens.setdefault(
                    key,
                    {
                        "quantity": field,
                        "measurement_group": measurement_group,
                        "reason_counts": {},
                        "unit": "tokens",
                        "scope": measured["scope"],
                        "value": 0,
                        "applicable_count": 0,
                        "unknown_count": 0,
                        "partial_count": 0,
                        "unvalidated_count": 0,
                        "contributing_attempt_count": 0,
                    },
                )
                if measured.get("reason"):
                    reason = measured["reason"]
                    series["reason_counts"][reason] = series["reason_counts"].get(reason, 0) + 1
                series["applicable_count"] += 1
                if measured["value"] is None:
                    series["unknown_count"] += 1
                else:
                    series["value"] += int(measured["value"])
                    series["contributing_attempt_count"] += 1
                series["partial_count"] += measured["completeness"] != "complete_for_scope"
                series["unvalidated_count"] += measured["evidence"] == "heuristic_estimate"
            estimate = record.estimate.get("result")
            if not estimate or estimate.get("reference_only"):
                continue
            from .engine_adapter import projection

            estimate = projection(estimate)
            for reference in estimate.get("image_references", []):
                group = {
                    key: reference.get(key)
                    for key in (
                        "selected_profile_id",
                        "cohort_id",
                        "cohort_hash",
                        "profile_selection",
                        "starting_energy_boundary",
                    )
                }
                if estimate.get("schema_version") == "3.0.0":
                    group.update(
                        {k: estimate[k] for k in ("requested_method", "effective_method", "comparability")}
                    )
                group["method_id"], group["method_hash"] = estimate["method_id"], estimate["method_hash"]
                media_value(
                    image_references,
                    "energy",
                    reference["gpu_kwh"],
                    "kWh",
                    "gpu_associated_reference",
                    group,
                    reference.get("reasons", []),
                    True,
                )
            methods.add(estimate["method_id"])
            for quantity, metric in estimate.get("metrics", {}).items():
                group = {
                    key: estimate.get(key)
                    for key in (
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
                    )
                }
                key = canonical(group) + ":" + quantity + ":" + metric["scope"] + ":" + metric["unit"]
                if estimate.get("schema_version") == "3.0.0":
                    group.update(
                        {k: estimate[k] for k in ("requested_method", "effective_method", "comparability")}
                    )
                    group["interval_kind"] = metric["interval_kind"]
                    key = canonical(group) + ":" + quantity + ":" + metric["scope"] + ":" + metric["unit"]
                series = resources.setdefault(
                    key,
                    {
                        "quantity": quantity,
                        "unit": metric["unit"],
                        "scope": metric["scope"],
                        "method_group": group,
                        "reason_counts": {},
                        "value": Decimal(0),
                        **(
                            {
                                "scenario_low": Decimal(0),
                                "scenario_high": Decimal(0),
                                "interval_kind": None,
                                "value_kind": "midpoint_sum",
                            }
                            if metric.get("scenario_low") is not None
                            else {}
                        ),
                        "applicable_count": 0,
                        "unknown_count": 0,
                        "partial_count": 0,
                        "unvalidated_count": 0,
                        "contributing_attempt_count": 0,
                    },
                )
                for reason in set(metric.get("reasons", [])):
                    series["reason_counts"][reason] = series["reason_counts"].get(reason, 0) + 1
                if metric["status"] == "partial_estimate":
                    series["partial_count"] += 1
                if estimate.get("validation_state") == "unvalidated_reference":
                    series["unvalidated_count"] += 1
                series["applicable_count"] += 1
                if metric["value"] is None:
                    series["unknown_count"] += 1
                else:
                    series["value"] += Decimal(metric["value"])
                    if metric.get("scenario_low") is not None and "scenario_low" in series:
                        # Scenario sums add the same endpoint of every ranged record in the group.
                        series["scenario_low"] += Decimal(metric["scenario_low"])
                        series["scenario_high"] += Decimal(metric["scenario_high"])
                    series["contributing_attempt_count"] += 1
        for series in [
            *tokens.values(),
            *resources.values(),
            *media_counts.values(),
            *image_references.values(),
            *files.values(),
        ]:
            finalize_series_value(series)
        return {
            **snapshot,
            "suppressed": False,
            "request_count": str(request_count),
            "observed_search_operations": str(search_count),
            "search_known_request_count": str(search_known),
            "search_unknown_request_count": str(search_unknown),
            "search_count_scope": "explicit_observed_operations",
            "attempt_count": str(attempt_count),
            "unconfirmed_attempt_count": str(unconfirmed_count),
            "unresolved_request_count": str(unresolved_count),
            "active_users": str(len(users)),
            "active_installations": str(len(devices)),
            "outcomes": {
                state: str(outcomes.get(state, 0))
                for state in (
                    "completed",
                    "cancelled",
                    "failed",
                    "generating",
                    "dispatched",
                    "interrupted_unconfirmed",
                )
            },
            "tokens": list(tokens.values()),
            "resources": list(resources.values()),
            "media_counts": list(media_counts.values()),
            "image_references": list(image_references.values()),
            "file_text": list(files.values()),
            **({"file_text_disclosure": file_presence} if with_disclosures else {}),
            "file_text_coverage": {
                **{k: str(v) for k, v in files_coverage.items()},
                "scope": "extracted_file_text",
                "additive": False,
            },
            "method_groups": sorted(methods),
            "mixed_methods": len(methods) > 1,
            "pending_estimates": str(pending_count),
            "coverage": {
                "recorded_attempts": str(attempt_count),
                "resource_applicable_count": str(attempt_count),
                "resource_unknown_count": str(unknown_count),
                "resource_scope": "available compatible operational components only",
                "unknown_is_zero": False,
                "reference_only_excluded": True,
            },
        }

    def network(self, s, company, member, query):
        return self.admin_queries.network(s, company, member, query)

    def person_floor(self, s, company):
        """
        The first instant (and its day) that a per-person administrator view may show: the start of
        the first full day, in the organization's time zone, after person analytics was switched
        on. Daily totals cannot be split within a day, so the day of the switch is left out
        entirely, and every per-person view uses the same floor so their figures agree. With
        person analytics off there is no per-person view at all.
        """
        since = self.service.person_analytics_since(s)
        if since is None:
            raise Problem("person_analytics_disabled", 400)
        zone = ZoneInfo(company.data["timezone"])
        local = parse_time(since).astimezone(zone)
        day = local.replace(hour=0, minute=0, second=0, microsecond=0)
        if day < local:
            day = datetime.combine(day.date() + timedelta(days=1), datetime.min.time(), zone)
        return instant(day.astimezone(UTC)), day.date().isoformat()

    ACTIVITY_FILTERS = {"period", "start", "end", "calculation_view", "method_id"}

    def activity(self, s, company, member, query):
        """
        The Activity page: the organization's requests per day and its usage by tool and model, each
        part with its distinct people as a count (active_users). It is the administrator summary
        with its splits, so every figure matches the Overview and the Tools and models page in the
        same calculation view. Nothing is split by person and no person filter is accepted, in
        either setting of person analytics (owner decision of 18 October 2026). Days come for
        windows of up to 62 days, as in summary splits.
        """
        self.service.refuse_person_filter(query)
        if set(query) - self.ACTIVITY_FILTERS:
            raise Problem("unsupported_filter", 422)
        from .history_matching import read_memo

        with read_memo(s):
            result = self.summary(s, company, member, query)
            if result.get("aggregate_status") != "current":
                return result
            result["history"] = self.history.summary(s, company, None, None, query)
            parts = self.splits(s, company, member, query, result, private=False)
        # The tool parts carry the requests no model was named for (often all of Perplexity's), so
        # the page's rows by tool and model add up to the whole.
        return {
            **result,
            "days": parts.get("days"),
            "sites": parts.get("sites", {}),
            "models": parts.get("models", {}),
        }

    def preview(self, s, company, member, body):
        return self.deletions.preview(s, company, member, body)

    def erase(self, s, company, actor, body):
        return self.deletions.execute(s, company, actor, body)

    def apply_erasure(self, s, company, marker):
        job = self.deletions.schedule_marker(s, company, marker)
        before = job.data["records_erased"]
        self.deletions.advance(s, company, job)
        return job.data["records_erased"] - before

    def journal(self, tenant, marker):
        path = self.service.settings.deletion_journal_path
        if not path:
            raise Problem("configuration_required", 503)
        from .journal import append

        append(path, self.service.secrets, {"tenant": tenant, "marker": marker})

    def receipt(self, s, ctx, body, acknowledge=False):
        data = (
            (dto.ReceiptAck if acknowledge else dto.ReceiptStatus)
            .model_validate_json(canonical(body))
            .model_dump(mode="json")
        )
        # At the shared hosted address the device id names the organization; an unknown one is
        # refused as a wrong receipt is, not as a missing sign-in.
        if not (ctx["tenant_origin"] if "tenant_origin" in ctx else ctx["origin"]):
            raise Problem("deletion_receipt_denied", 403)
        company = self.service.tenant_of(s, ctx, allow_inactive=True)
        receipt = get(s, "deletion_receipt", data["device_id"], company.id)
        if not receipt or not __import__("hmac").compare_digest(
            receipt.data["hash"], digest(data["credential"])
        ):
            raise Problem("deletion_receipt_denied", 403)
        if data["last_epoch"] > company.data["epoch"]:
            raise Problem("invalid_epoch", 409)
        if acknowledge:
            receipt.data = {**receipt.data, "ack_epoch": max(receipt.data["ack_epoch"], data["last_epoch"])}
            return {"acknowledged_epoch": receipt.data["ack_epoch"]}
        instruction = {
            "company_id": company.id,
            "device_id": data["device_id"],
            **self.deletions.change_page(s, company, receipt.owner, data["last_epoch"]),
            "issued_at": instant(self.service.now()),
            "retention_cutoff": self.cutoff(s, company),
        }
        signature = (
            base64.urlsafe_b64encode(self.signer.sign(canonical(instruction).encode())).decode().rstrip("=")
        )
        return {
            "instruction": instruction,
            "signature": signature,
            "algorithm": "Ed25519",
            "key_version": "1",
        }

    def public_key(self):
        raw = self.signer.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    def export(self, s, company, member, body):
        return self.exports.create(s, company, member, body)

    def maintenance(self, s, company):
        from .maintenance import maintain_tenant

        return maintain_tenant(self.service, s, company)
