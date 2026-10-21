"""Owner-scoped, bounded administrative queries with filter-bound live keyset cursors."""

import base64
import hmac
import json
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from footprint_contracts import claude_factor_for, claude_token_fields
from sqlalchemy import Numeric, and_, cast, func, or_, select, tuple_

from .db import TABLES, DailyRollup, Member, NetworkObservation, Observation, RequestAttemptLink
from .method_history import resolve_estimate
from .security import Problem, canonical, digest, parse_time


class AdminQueries:
    def __init__(self, analytics):
        self.analytics, self.service = analytics, analytics.service

    def cursor(self, company, namespace, filters, position=None, interval=None):
        scope = digest(
            canonical(
                [
                    company.id,
                    company.data["policy_version"],
                    namespace,
                    {k: v for k, v in filters.items() if k != "cursor"},
                ]
            )
        )
        if position is not None:
            payload = {
                "scope": scope,
                "position": position,
                "interval": interval,
                "expires": self.service.expires(86400),
            }
            encoded = base64.urlsafe_b64encode(canonical(payload).encode()).decode().rstrip("=")
            return encoded + "." + self.service.secrets.keyed("query-cursor", encoded)
        supplied = filters.get("cursor")
        if not supplied:
            return None, interval
        try:
            if not isinstance(supplied, str) or len(supplied) > 4096:
                raise ValueError
            encoded, mac = supplied.split(".")
            if not hmac.compare_digest(mac, self.service.secrets.keyed("query-cursor", encoded)):
                raise ValueError
            payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
            if (
                set(payload) != {"scope", "position", "interval", "expires"}
                or payload["scope"] != scope
                or not self.service.alive(payload["expires"])
            ):
                raise ValueError
            if (
                not isinstance(payload["position"], list)
                or len(payload["position"]) > 3
                or any(not isinstance(item, str) or len(item) > 200 for item in payload["position"])
            ):
                raise ValueError
            return payload["position"], payload["interval"]
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            raise Problem("invalid_cursor", 422) from None

    def protocol_page(self, session, kind, query, tenant=None):
        from types import SimpleNamespace

        if set(query) - {"limit", "cursor"}:
            raise Problem("unsupported_filter", 422)
        try:
            limit = int(query.get("limit", 100))
            if not 1 <= limit <= 200:
                raise ValueError
        except (TypeError, ValueError):
            raise Problem("invalid_limit", 422) from None
        scope = SimpleNamespace(id=tenant or "operator", data={"policy_version": "1"})
        position, _ = self.cursor(scope, kind, query)
        cls = TABLES[kind]
        statement = select(cls)
        if tenant is not None:
            statement = statement.where(cls.tenant == tenant)
        if position:
            if len(position) != 1:
                raise Problem("invalid_cursor", 422)
            statement = statement.where(cls.id > position[0])
        records = list(session.scalars(statement.order_by(cls.id).limit(limit + 1)))
        cursor = self.cursor(scope, kind, query, [records[limit - 1].id]) if len(records) > limit else None
        return records[:limit], cursor

    def filters(self, company, query, allowed):
        if set(query) - allowed:
            raise Problem("unsupported_filter", 422)
        for key in ("user_id", "device_id"):
            if query.get(key):
                try:
                    UUID(query[key])
                except (ValueError, TypeError):
                    raise Problem("unsupported_filter", 422) from None
        if query.get("site") and query["site"] not in {"chatgpt", "claude", "gemini", "perplexity", "notebooklm"}:
            raise Problem("unsupported_filter", 422)
        _, limit = self.service.pagination({"limit": query.get("limit", 50)})
        period_filters = {
            k: v for k, v in query.items() if k in {"start", "end", "period", "site", "model", "user_id"}
        }
        return limit, self.analytics.bounds(company, period_filters)

    def audit(self, session, company, query, operator=False):
        if set(query) - {"limit", "cursor"}:
            raise Problem("unsupported_filter", 422)
        _, limit = self.service.pagination({"limit": query.get("limit", 50)})
        if operator:
            from types import SimpleNamespace

            company = SimpleNamespace(id="operator", data={"policy_version": "1.0.0"})
        position, _ = self.cursor(company, "operator-audit" if operator else "admin-audit", query)
        cls = TABLES["audit"]
        timestamp = cls.data["at"].as_string()
        conditions = (
            [
                or_(
                    cls.data["actor_kind"].as_string() == "operator",
                    cls.data["actor"].as_string() == "operator",
                )
            ]
            if operator
            else [cls.tenant == company.id]
        )
        if position:
            if len(position) != 2:
                raise Problem("invalid_cursor", 422)
            conditions.append(
                or_(timestamp < position[0], and_(timestamp == position[0], cls.id > position[1]))
            )
        records = list(
            session.scalars(
                select(cls).where(*conditions).order_by(timestamp.desc(), cls.id).limit(limit + 1)
            )
        )
        tail = records[limit - 1] if len(records) > limit else None
        return {
            # The developer panel names the organization an action changed; global actions have none.
            "items": [{**r.data, "company_id": r.tenant or None} if operator else r.data for r in records[:limit]],
            "next_cursor": self.cursor(
                company, "operator-audit" if operator else "admin-audit", query, [tail.data["at"], tail.id]
            )
            if tail
            else None,
        }

    @staticmethod
    def after_desc(time_column, owner_column, id_column, position):
        return or_(
            time_column < position[0],
            and_(time_column == position[0], tuple_(owner_column, id_column) > tuple(position[1:])),
        )

    def requests(self, session, company, query):
        if self.analytics.deletions.in_progress(session, company):
            raise Problem("deletion_in_progress", 409, True)
        limit, interval = self.filters(
            company, query, {"start", "end", "period", "site", "model", "user_id", "limit", "cursor"}
        )
        position, interval = self.cursor(company, "admin-requests", query, interval=interval)
        start, end = interval
        # Every row names its person, so the list starts after person analytics was switched on.
        floor, _ = self.analytics.person_floor(session, company)
        conditions = [
            Observation.tenant == company.id,
            Observation.kind == "request",
            # Read aloud adds speech to a reply already listed (G1) and NotebookLM writes
            # its notebook guides by itself (W9); neither is a request.
            Observation.payload["action"].as_string().notin_(("read_aloud", "notebook_guide")),
            Observation.status != "aliased",
            Observation.occurred_at >= max(start, self.analytics.cutoff(session, company) or start, floor),
            Observation.occurred_at < end,
        ]
        for key, column in (
            ("user_id", Observation.owner),
            ("site", Observation.site),
            ("model", Observation.model),
        ):
            if query.get(key):
                conditions.append(column == query[key])
        if position:
            if len(position) != 3:
                raise Problem("invalid_cursor", 422)
            conditions.append(
                self.after_desc(Observation.occurred_at, Observation.owner, Observation.id, position)
            )
        records = list(
            session.scalars(
                select(Observation)
                .where(*conditions)
                .order_by(Observation.occurred_at.desc(), Observation.owner, Observation.id)
                .limit(limit + 1)
            )
        )
        pairs = [(row.owner, row.id) for row in records[:limit]]
        counts = {
            (owner, parent): count
            for owner, parent, count in session.execute(
                select(Observation.owner, Observation.parent, func.count())
                .where(
                    Observation.tenant == company.id,
                    Observation.kind == "attempt",
                    Observation.status != "aliased",
                    tuple_(Observation.owner, Observation.parent).in_(pairs),
                )
                .group_by(Observation.owner, Observation.parent)
            )
        }
        shared = {
            (owner, request): count
            for owner, request, count in session.execute(
                select(RequestAttemptLink.owner, RequestAttemptLink.request_id, func.count())
                # A shared attempt can come from an earlier request; one from before the floor is
                # not counted, as request details do not list it.
                .join(
                    Observation,
                    and_(
                        Observation.tenant == RequestAttemptLink.tenant,
                        Observation.owner == RequestAttemptLink.owner,
                        Observation.kind == "attempt",
                        Observation.id == RequestAttemptLink.attempt_id,
                    ),
                )
                .where(
                    RequestAttemptLink.tenant == company.id,
                    tuple_(RequestAttemptLink.owner, RequestAttemptLink.request_id).in_(pairs),
                    Observation.occurred_at >= floor,
                )
                .group_by(RequestAttemptLink.owner, RequestAttemptLink.request_id)
            )
        }
        figures = self.request_figures(session, company, pairs)
        items = [
            {
                key: row.payload[key]
                for key in (
                    "request_id",
                    "dispatched_at",
                    "ended_at",
                    "site",
                    "model_id",
                    "state",
                    "coverage_reasons",
                )
            }
            | {
                "user_id": row.owner,
                "attempt_count": str(counts.get((row.owner, row.id), 0)),
                "shared_attempt_count": str(shared.get((row.owner, row.id), 0)),
                "detail_path": f"/v1/admin/users/{row.owner}/requests/{row.id}",
                "figures": figures.get(
                    (row.owner, row.id),
                    {"tokens_in": None, "tokens_out": None, "energy": None, "energy_status": "unknown"},
                ),
            }
            for row in records[:limit]
        ]
        tail = records[limit - 1] if len(records) > limit else None
        return {
            "items": items,
            "next_cursor": self.cursor(
                company, "admin-requests", query, [tail.occurred_at, tail.owner, tail.id], interval
            )
            if tail
            else None,
            "time_basis": "request_dispatch",
            "range_start": start,
            "range_end": end,
            # The page says when its list starts, since the period's totals also count earlier days.
            "person_analytics_since": floor,
            "pagination": "live_keyset",
        }

    # The bar's In and Out (lib/token-summary.ts INPUT_FIELDS and OUTPUT_QUANTITIES).
    INPUT_TOKENS = ("new_input_text", "tool_output", "image_input_tokens")
    OUTPUT_TOKENS = ("output_total", "other_model_output")

    def request_figures(self, session, company, pairs):
        """
        Tokens in and out and electricity for each listed request, added from its own attempts as
        Details shows them. A shared attempt counts on the request that started it, so no attempt is
        counted twice. Electricity keeps the scenario ends, so the page can show any scenario.
        """
        if not pairs:
            return {}
        rows = session.scalars(
            select(Observation).where(
                Observation.tenant == company.id,
                Observation.kind == "attempt",
                Observation.status != "aliased",
                tuple_(Observation.owner, Observation.parent).in_(pairs),
            )
        )
        from .engine_adapter import packaged_claude_token_factor

        factor = packaged_claude_token_factor()
        totals = {}
        for row in rows:
            entry = totals.setdefault(
                (row.owner, row.parent),
                {"in": None, "out": None, "energy": [], "pending": False, "unknown": False},
            )
            tokens = row.payload.get("tokens") or {}
            # Claude text counts carry the Claude token factor, as Details shows them.
            if tokens:
                tokens = claude_token_fields(tokens, claude_factor_for(row.site, row.payload.get("model_id"), factor))
            for side, fields in (("in", self.INPUT_TOKENS), ("out", self.OUTPUT_TOKENS)):
                for field in fields:
                    value = (tokens.get(field) or {}).get("value")
                    if value is not None:
                        entry[side] = (entry[side] or 0) + int(value)
            try:
                estimate = resolve_estimate(session, row) or {}
            except Problem:
                # A lineage conflict leaves this row's electricity unknown; Details explains it.
                estimate = {}
            metric = ((estimate.get("result") or {}).get("metrics") or {}).get("energy") or {}
            if estimate.get("status") == "pending":
                entry["pending"] = True
            elif metric.get("value") is None or metric.get("unit") != "kWh":
                entry["unknown"] = True
            else:
                entry["energy"].append(metric)
        out = {}
        for key, entry in totals.items():
            energy = None
            if entry["energy"] and not entry["pending"] and not entry["unknown"]:
                ranged = any(m.get("scenario_low") is not None for m in entry["energy"])
                total = sum(Decimal(m["value"]) for m in entry["energy"])
                low = sum(Decimal(m.get("scenario_low") or m["value"]) for m in entry["energy"])
                high = sum(Decimal(m.get("scenario_high") or m["value"]) for m in entry["energy"])
                energy = {
                    "value": format(total, "f"),
                    "unit": "kWh",
                    "value_kind": "midpoint_sum" if ranged else "scalar",
                    "scenario_low": format(low, "f") if ranged else None,
                    "scenario_high": format(high, "f") if ranged else None,
                }
            out[key] = {
                "tokens_in": None if entry["in"] is None else str(entry["in"]),
                "tokens_out": None if entry["out"] is None else str(entry["out"]),
                "energy": energy,
                "energy_status": "pending"
                if entry["pending"]
                else "unknown"
                if entry["unknown"] or not entry["energy"]
                else "available",
            }
        return out

    def detail(self, session, company, user_id, request_id, query):
        for identifier in (user_id, request_id):
            try:
                UUID(identifier)
            except ValueError:
                raise Problem("not_found", 404) from None
        if set(query) - {"limit", "cursor"}:
            raise Problem("unsupported_filter", 422)
        request = session.get(Observation, (company.id, user_id, "request", request_id))
        if not request or self.analytics.erased(
            session, company, user_id, request.occurred_at, "request", request.id
        ):
            raise Problem("not_found", 404)
        cutoff = self.analytics.cutoff(session, company)
        if cutoff and request.occurred_at < cutoff:
            raise Problem("retention_expired", 404)
        # A request from before person analytics was switched on is never shown by person, nor is
        # an attempt from before then (or before the retention cutoff) that it shares.
        floor = self.analytics.person_floor(session, company)[0]
        if request.occurred_at < floor:
            raise Problem("not_found", 404)
        _, limit = self.service.pagination({"limit": query.get("limit", 50)})
        namespace = "request-detail:" + user_id + ":" + request_id
        position, _ = self.cursor(company, namespace, query)
        linked = select(RequestAttemptLink.attempt_id).where(
            RequestAttemptLink.tenant == company.id,
            RequestAttemptLink.owner == user_id,
            RequestAttemptLink.request_id == request_id,
        )
        conditions = [
            Observation.tenant == company.id,
            Observation.owner == user_id,
            Observation.kind == "attempt",
            Observation.status != "aliased",
            or_(Observation.parent == request_id, Observation.id.in_(linked)),
            Observation.occurred_at >= max(floor, cutoff or floor),
        ]
        total = session.scalar(select(func.count()).select_from(Observation).where(*conditions))
        if position:
            if len(position) != 3:
                raise Problem("invalid_cursor", 422)
            conditions.append(
                self.after_desc(Observation.occurred_at, Observation.owner, Observation.id, position)
            )
        attempts = session.scalars(
            select(Observation)
            .where(*conditions)
            .order_by(Observation.occurred_at.desc(), Observation.owner, Observation.id)
            .limit(limit + 1)
            .execution_options(yield_per=1)
        )
        history = TABLES["revision"]
        safe_request = {
            key: value
            for key, value in request.payload.items()
            if key not in {"conversation_key", "provider_request_key"}
        }
        items = []
        size = 0
        last = None
        has_more = False
        for row in attempts:
            if len(items) == limit:
                has_more = True
                break
            item = {key: value for key, value in row.payload.items() if key != "provider_attempt_key"}
            item.update(
                canonical_parent_id=row.parent,
                contribution="originating" if row.parent == request_id else "shared_reference",
                server_record_version=row.revision,
                payload_hash=row.payload_hash,
                revision_count=session.scalar(
                    select(func.count())
                    .select_from(history)
                    .where(
                        history.tenant == company.id,
                        history.owner == user_id,
                        history.record_kind == "attempt",
                        history.record_id == row.id,
                    )
                ),
                estimate=resolve_estimate(session, row),
                observation=row.payload,
            )
            row_size = len(canonical(item).encode("utf-8"))
            if items and size + row_size > 1048576:
                has_more = True
                break
            items.append(item)
            size += row_size
            last = row
        tail = last if has_more else None
        return {
            "request": safe_request,
            "observation": request.payload,
            "canonical": {
                "company_id": company.id,
                "user_id": user_id,
                "request_id": request.id,
                "revision": request.revision,
                "payload_hash": request.payload_hash,
                "status": request.status,
            },
            "attempt_count": str(total),
            "attempts": items,
            "next_cursor": self.cursor(company, namespace, query, [tail.occurred_at, tail.owner, tail.id])
            if tail
            else None,
            "time_basis": {"request": "dispatch", "attempts": "attempt_start"},
            "shared_attempts_count_once": True,
        }

    def breakdown(self, session, company, query):
        if (
            self.analytics.deletions.in_progress(session, company)
            or company.data.get("aggregate_status") == "rebuilding"
        ):
            raise Problem("aggregate_rebuilding", 409, True)
        limit, interval = self.filters(
            company,
            query,
            {"group_by", "start", "end", "period", "site", "model", "user_id", "limit", "cursor"},
        )
        group = query.get("group_by", "site_model")
        if group not in {"site", "model", "site_model"}:
            raise Problem("unsupported_filter", 422)
        position, interval = self.cursor(company, "admin-breakdown:" + group, query, interval=interval)
        zone = ZoneInfo(company.data["timezone"])
        start, end = interval
        cutoff = self.analytics.cutoff(session, company)
        first = parse_time(max(start, cutoff or start)).astimezone(zone).date().isoformat()
        last = parse_time(end).astimezone(zone).date().isoformat()
        if query.get("user_id"):
            # One person's breakdown starts on the first full day after person analytics was on.
            first = max(first, self.analytics.person_floor(session, company)[1])
        conditions = [
            DailyRollup.tenant == company.id,
            DailyRollup.day >= first,
            DailyRollup.day < last,
            DailyRollup.active_observation_count > 0,
        ]
        for key, column in (
            ("site", DailyRollup.site),
            ("model", DailyRollup.model),
            ("user_id", DailyRollup.owner),
        ):
            if query.get(key):
                conditions.append(column == query[key])
        dimensions = (
            [DailyRollup.site]
            if group == "site"
            else [func.coalesce(DailyRollup.model, "")]
            if group == "model"
            else [DailyRollup.site, func.coalesce(DailyRollup.model, "")]
        )
        if position:
            if len(position) != len(dimensions):
                raise Problem("invalid_cursor", 422)
            conditions.append(
                dimensions[0] > position[0] if len(dimensions) == 1 else tuple_(*dimensions) > tuple(position)
            )
        metrics = [
            func.sum(DailyRollup.request_count),
            func.sum(cast(DailyRollup.data["value"]["attempt_count"].as_string(), Numeric(38, 0))),
            func.count(func.distinct(DailyRollup.owner)),
            func.sum(
                cast(DailyRollup.data["value"]["unconfirmed_attempt_count"].as_string(), Numeric(38, 0))
            ),
        ]
        records = list(
            session.execute(
                select(*dimensions, *metrics)
                .where(*conditions)
                .group_by(*dimensions)
                .order_by(*dimensions)
                .limit(limit + 1)
            )
        )
        items = []
        for row in records[:limit]:
            count = len(dimensions)
            items.append(
                {
                    "site": row[0] if group != "model" else None,
                    "model_id": (row[count - 1] or None) if group != "site" else None,
                    "request_count": str(int(row[count] or 0)),
                    "attempt_count": str(int(row[count + 1] or 0)),
                    "active_users": str(row[count + 2]),
                    "unconfirmed_attempt_count": str(int(row[count + 3] or 0)),
                }
            )
        tail = list(records[limit - 1][: len(dimensions)]) if len(records) > limit else None
        return {
            "items": items,
            "group_by": group,
            "next_cursor": self.cursor(company, "admin-breakdown:" + group, query, tail, interval)
            if tail
            else None,
            "range_start": start,
            "range_end": end,
            "time_basis": {"requests": "dispatch", "attempts": "attempt_start"},
            "complete_source": "all_matching_daily_rollups",
        }

    # The usage spread on the People page; bins as the canvas draws them, counting only people with requests.
    PEOPLE_BINS = ((0, 100), (100, 250), (250, 500), (500, 750), (750, 1000), (1000, None))

    def people(self, session, company, query):
        """
        How usage spreads across the organization in the period: how many people used AI, the
        median, average and largest request count per person, and how many people fall in each
        band. Small groups are not hidden: in an organization of one or two people these figures
        can describe one person, which the privacy texts say.

        While person analytics is off (the default) only these aggregates leave the server; no
        count is returned per person, not even under a member id (owner decision of 18 October
        2026). With it on, requests also maps each member id to their requests, counted from the
        first full day after person analytics was switched on (Analytics.person_floor).

        A person's requests are counted as the summary counts them: live requests from the daily
        rollups plus the requests their saved history adds (history prompt_count: saved prompts and
        regenerations no live record matched). Until 15 October 2026 only live requests counted, so
        a person who imported saved chats showed 22 requests here and 358 in the summary.
        """
        if (
            self.analytics.deletions.in_progress(session, company)
            or company.data.get("aggregate_status") == "rebuilding"
        ):
            raise Problem("aggregate_rebuilding", 409, True)
        _, interval = self.filters(company, query, {"start", "end", "period"})
        start, end = interval
        counts = self.request_counts(session, company, query, interval)
        used = sorted(count for count in counts.values() if count > 0)
        members = list(
            session.execute(
                select(Member.role).where(Member.tenant == company.id, Member.status == "active")
            ).scalars()
        )
        middle = len(used) // 2
        median = None if not used else used[middle] if len(used) % 2 else (used[middle - 1] + used[middle]) / 2
        result = {
            "range_start": start,
            "range_end": end,
            "used": len(used),
            "members": len(members),
            "administrators": sum(1 for role in members if role == "admin"),
            "capacity": company.data["capacity"],
            "median_requests": self.count_text(median),
            # Among the people who used AI, like the median, so members who never used it do not
            # pull the typical figure down.
            "average_requests": self.count_text(sum(used) / len(used)) if used else None,
            # The largest count alone, with no id: the website shows it without a name.
            "max_requests": str(used[-1]) if used else None,
            "bins": [
                {
                    "from": low,
                    "to": high,
                    "people": sum(1 for count in used if count > low and (high is None or count <= high)),
                }
                for low, high in self.PEOPLE_BINS
            ],
        }
        if self.service.settings.person_analytics_enabled:
            floor = self.analytics.person_floor(session, company)
            named = self.request_counts(session, company, query, interval, floor)
            result["requests"] = {owner: str(count) for owner, count in named.items() if count > 0}
            result["person_analytics_since"] = floor[0]
        return result

    @staticmethod
    def count_text(value):
        """A per-person request figure as text: whole numbers exact, others to one decimal place."""
        if value is None:
            return None
        return str(int(value)) if value == int(value) else f"{value:.1f}"

    def request_counts(self, session, company, query, interval, floor=None):
        """
        Each person's requests in the interval, keyed by member id. people() returns this map only
        while person analytics is on, and then only from floor (an instant and its day); otherwise
        it stays inside the server and only the aggregates leave.
        """
        zone = ZoneInfo(company.data["timezone"])
        start, end = interval
        cutoff = self.analytics.cutoff(session, company)
        first = parse_time(max(start, cutoff or start)).astimezone(zone).date().isoformat()
        last = parse_time(end).astimezone(zone).date().isoformat()
        if floor:
            first = max(first, floor[1])
        counts = {
            owner: int(total or 0)
            for owner, total in session.execute(
                select(DailyRollup.owner, func.sum(DailyRollup.request_count))
                .where(
                    DailyRollup.tenant == company.id,
                    DailyRollup.day >= first,
                    DailyRollup.day < last,
                    DailyRollup.active_observation_count > 0,
                )
                .group_by(DailyRollup.owner)
            )
        }
        for owner, saved in self.saved_requests(session, company, query, floor[0] if floor else None).items():
            counts[owner] = counts.get(owner, 0) + saved
        return counts

    def saved_requests(self, session, company, query, since=None):
        """
        Per person, the requests their saved history adds to the summary for the same query. The
        summary adds them only while its saved-history part is available (at most 10,000 saved
        messages in the period), and so does this.
        """
        from .db import HistoryObservation
        from .history_matching import read_memo

        history = self.analytics.history
        found = {}
        # One read memo shares erasure markers, retention and matched live records between people.
        with read_memo(session):
            # Within the organization's limit every person's saved messages are within their own,
            # and one pass over everyone's counts each person's as their own summary does.
            whole = history.summary(session, company, None, None, query, requests_only=True, since=since)
            if whole["status"] != "unavailable":
                return whole["prompt_count_by_owner"]
            owners = session.scalars(
                select(HistoryObservation.owner).where(HistoryObservation.tenant == company.id).distinct()
            )
            for owner in sorted(owners):
                saved = history.summary(session, company, owner, None, query, requests_only=True, since=since)
                if saved["status"] == "available":
                    found[owner] = int(saved["prompt_count"])
        return found

    def network(self, session, company, actor, query):
        if self.analytics.deletions.in_progress(session, company):
            raise Problem("deletion_in_progress", 409, True)
        limit, interval = self.filters(
            company, query, {"start", "end", "period", "user_id", "device_id", "limit", "cursor"}
        )
        position, interval = self.cursor(company, "admin-network", query, interval=interval)
        start, end = interval
        from datetime import timedelta

        from .security import instant

        retained_from = instant(self.service.now() - timedelta(days=self.service.settings.ip_retention_days))
        # Each row names a member, so rows from before person analytics was switched on stay hidden.
        retained_from = max(retained_from, self.analytics.person_floor(session, company)[0])
        base = [
            NetworkObservation.tenant == company.id,
            NetworkObservation.observed_at >= max(start, retained_from),
            NetworkObservation.observed_at < end,
        ]
        for key, column in (
            ("user_id", NetworkObservation.owner),
            ("device_id", NetworkObservation.device_id),
        ):
            if query.get(key):
                base.append(column == query[key])
        from .ip_rotation import distinct_coverage

        ip_coverage = distinct_coverage(session, self.service.secrets, base)
        conditions = list(base)
        if position:
            if len(position) != 3:
                raise Problem("invalid_cursor", 422)
            conditions.append(
                self.after_desc(
                    NetworkObservation.observed_at, NetworkObservation.owner, NetworkObservation.id, position
                )
            )
        records = list(
            session.scalars(
                select(NetworkObservation)
                .where(*conditions)
                .order_by(
                    NetworkObservation.observed_at.desc(), NetworkObservation.owner, NetworkObservation.id
                )
                .limit(limit + 1)
            )
        )
        self.service.audit(session, company.id, actor.id, "network_viewed", company.id)
        items = [
            {
                "network_observation_id": row.id,
                "user_id": row.owner,
                "device_id": row.device_id,
                "observed_at": row.observed_at,
                "address": self.service.secrets.decrypt_ip(
                    row.data["address"], row.data.get("key_version", "1")
                )
                if row.data["address"]
                else None,
                "source_quality": row.data["source_quality"],
                "accepted_record_count": row.accepted_record_count,
            }
            for row in records[:limit]
        ]
        tail = records[limit - 1] if len(records) > limit else None
        return {
            "items": items,
            "next_cursor": self.cursor(
                company, "admin-network", query, [tail.observed_at, tail.owner, tail.id], interval
            )
            if tail
            else None,
            "label": "Connection IP observed by company server",
            "time_basis": "upload_receipt",
            "coverage_start": max(start, retained_from),
            "range_end": end,
            "incomplete_history": start < retained_from,
            **ip_coverage,
            "pagination": "live_keyset",
        }
