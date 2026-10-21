"""Numeric loaded-history evidence. Import time establishes ownership, not execution time."""

import re
from datetime import timedelta
from decimal import Decimal, localcontext
from functools import lru_cache

from footprint_contracts import (
    ContractError,
    canonical_json,
    claude_history_message,
    history_token_parts,
    payload_hash,
    regenerated_history_replies,
    validate_history_page,
)
from footprint_estimator import (
    baseline_bundle,
    environmental_allocation,
    text_energy,
)
from footprint_estimator import (
    fixed as quantity_string,
)
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import aliased, defer
from sqlalchemy.orm.util import identity_key

from .db import (
    DeletionScope,
    DeletionTombstone,
    EnrollmentEra,
    HistoryCoverage,
    HistoryObservation,
    HistoryTombstone,
)
from .security import Problem, instant, parse_time


def validate_page(body):
    try:
        return validate_history_page(body)
    except ContractError:
        raise Problem("payload_rejected", 422) from None


def numeric_payload_hash(record):
    return payload_hash({k: v for k, v in record.items() if k != "observed_at"})


def refine(old, new):
    from .timing_evidence import (
        fuller_history_tokens,
        generation_covers,
        grown_history_tokens,
        merge_history_evidence,
        side_parts_conflict,
    )

    # Checked before merging: a stale reread is replaced by the saved state, which would
    # hide a part it measured differently.
    if side_parts_conflict(old, new):
        return "conflict"
    new = merge_history_evidence(old, new)
    if numeric_payload_hash(old) == numeric_payload_hash(new):
        return "duplicate"
    if any(
        old[k] != new[k]
        for k in (
            "message_key",
            "role",
            "site",
            "conversation_key",
            "key_version",
            "proposed_method_id",
            "proposed_method_hash",
        )
    ):
        return "conflict"
    # The model is reconciled by merge_history_evidence, so it is not an identity field.
    if any(
        old[k] is not None and old[k] != new[k]
        for k in (
            "parent_key",
            "prompt_key",
            "provider_request_key",
            "provider_attempt_key",
            "occurred_at",
        )
    ):
        return "conflict"
    if old["date_basis"] != "unknown" and old["date_basis"] != new["date_basis"]:
        return "conflict"
    grown = grown_history_tokens(old, new)
    if (old["text_complete"] and not new["text_complete"]) or (
        old["tokens"]["value"] is not None
        and old["tokens"] != new["tokens"]
        and not fuller_history_tokens(old, new)
        and not grown
    ):
        return "conflict"
    if (
        not grown
        and old["timing"] is not None
        and old["timing"] != new["timing"]
        and "historical_timing_conflict" not in new["coverage_reasons"]
        and not (
            old["timing"]["completeness"] != "complete_for_scope"
            and new["timing"] is not None
            and new["timing"]["completeness"] == "complete_for_scope"
        )
    ):
        return "conflict"
    if old["inline_file_text"] is not None and old["inline_file_text"] != new["inline_file_text"]:
        return "conflict"
    if not generation_covers(new["generation"], old["generation"]):
        return "conflict"
    if side_parts_conflict(old, new):
        return "conflict"
    return "improved"


def estimate(record, bundle=None):
    with localcontext() as context:
        context.prec = 90
        return _estimate(record, bundle)


def _estimate(record, bundle=None):
    if record["role"] != "response":
        return []
    bundle = bundle or baseline_bundle()
    count = record["tokens"]["value"]
    candidates = (
        sorted(
            ((text_energy(count, p, bundle), p["id"]) for p in bundle["profiles"]),
            key=lambda pair: (-pair[0], pair[1]),
        )
        if count is not None and Decimal(count) > 0
        else []
    )
    a = environmental_allocation(candidates[0][0], "it", bundle["scenario"]) if candidates else {}
    result = []
    for quantity, key in (
        ("energy", "facility"),
        ("carbon", "carbon"),
        ("water_direct", "direct"),
        ("water_upstream", "upstream"),
        ("water_total", "total"),
    ):
        value = a.get(key)
        result.append(
            {
                "quantity": quantity,
                "value": quantity_string(value) if value is not None else None,
                "unit": "kWh"
                if quantity == "energy"
                else ("gCO2" if bundle["scenario"]["carbon_gas"] == "CO2" else "gCO2e")
                if quantity == "carbon"
                else "L",
                "scope": "historical_visible_response",
                "method_id": bundle["method_id"],
                "method_hash": payload_hash(bundle),
                "known_message_count": "0" if value is None else "1",
                "unknown_message_count": "1" if value is None else "0",
                "status": "unavailable" if value is None else "partial_estimate",
                "validation_state": "unvalidated_reference",
                "profile_selection": "highest_comparable" if candidates else "unavailable",
                "selected_profile_id": candidates[0][1] if candidates else None,
                "reasons": [
                    "history_only",
                    "unvalidated_reference",
                    "input_length_not_modelled",
                    "hidden_reasoning_unobserved",
                ],
                "missing_components": [*bundle["missing_components"], "provider_execution_unobserved"],
            }
        )
    return result


def empty_summary():
    return {
        "schema_version": "3.0.0",
        "scope": "loaded_history",
        "status": "empty",
        **{
            k: "0"
            for k in (
                "observed_prompt_count",
                "observed_response_count",
                "prompt_count",
                "response_count",
                "dated_message_count",
                "undated_message_count",
                "calculated_message_count",
                "uncalculated_message_count",
                "matched_live_message_count",
                "unresolved_overlap_message_count",
                "conflicting_message_count",
            )
        },
        "first_request_verified": False,
        "branch_scope": "unknown",
        "provider_history_complete": False,
        "tokens": [],
        "resources": [],
        "file_text": [],
        "file_text_coverage": {
            "observed_message_count": "0",
            "unknown_message_count": "0",
            "scope": "extracted_file_text",
            "additive": False,
        },
    }


def indexed_instant(value):
    return (
        parse_time(value).isoformat(timespec="microseconds").replace("+00:00", "Z")
        if value is not None
        else None
    )


def recorded_since(since):
    """
    Saved messages a per-person administrator view may show (Analytics.person_floor): only those
    sent at or after since. A message without a date is left out: the only time it carries is the
    one its browser reported, which cannot show that it was not saved while person analytics was
    off. Organization totals keep undated messages.
    """
    return HistoryObservation.occurred_at >= indexed_instant(since)


def recorded_before(since):
    """The saved messages recorded_since leaves out, undated ones included (SQL NULL safe)."""
    return or_(HistoryObservation.occurred_at < indexed_instant(since), HistoryObservation.occurred_at.is_(None))


def reply_models(replies):
    """Per prompt key, the model of its first reply that names one: the earliest occurred_at,
    undated replies last, then the lower message_key, as `replyFirst` in the extension's
    usage-breakdown.ts. A prompt answered by several models counts once, for its first reply."""

    def order(m):
        return (m["occurred_at"] is None, indexed_instant(m["occurred_at"]) or "", m["message_key"])

    first = {}
    for m in sorted(replies, key=order):
        prompt = answered_prompt(m)
        if m["model_id"] and prompt:
            first.setdefault(prompt, m["model_id"])
    return first


def answered_prompt(m):
    """The key of the saved prompt a saved reply answers, or None, as `answeredPrompt` in the
    extension's usage-breakdown.ts. ChatGPT names a reply's prompt (prompt_key) only when both
    carry the same request id in one read, while the reply still sits under its prompt in the
    chat's tree (parent_key). A parent that is a reply never equals a prompt's key."""
    if m["role"] != "response":
        return None
    return m["prompt_key"] or m.get("parent_key")


def answered_prompt_in(keys):
    """SQL for the saved replies whose answered_prompt is one of keys."""
    h = HistoryObservation
    prompt_key, parent_key = h.payload["prompt_key"].as_string(), h.payload["parent_key"].as_string()
    return or_(prompt_key.in_(keys), and_(prompt_key.is_(None), parent_key.in_(keys)))


def message_parts(m, claude_factor):
    """
    A saved message's token parts, with the Claude token factor applied part by part
    (claudeHistoryMessage), and its document text components. A summary with its day, tool and
    model splits adds the same message to four parts, so a read memo keeps these once per request.
    """
    from .file_text import project_components

    counted = claude_history_message(m, claude_factor)
    return list(history_token_parts(counted)), list(project_components(counted["inline_file_text"]))


def load_rows(s, conditions, order=(), limit=None):
    """
    The saved messages matching conditions, as select(HistoryObservation) would return them. Only
    the keys are read first: a summary with its splits reads the same rows dozens of times, and a
    full row costs four JSON decodes even when the session already holds it unchanged.
    """
    h = HistoryObservation
    statement = select(h.tenant, h.owner, h.message_key).where(*conditions).order_by(*order)
    keys = [tuple(key) for key in s.execute(statement if limit is None else statement.limit(limit))]
    # The identity map holds rows weakly, so every row is kept here until the list is built.
    rows, missing = {}, {}
    for key in keys:
        row = s.identity_map.get(identity_key(h, key))
        if row is None:
            missing.setdefault(key[:2], []).append(key[2])
        else:
            rows[key] = row
    for (tenant, owner), names in missing.items():
        for start in range(0, len(names), 500):
            chunk = names[start : start + 500]
            # The current estimate is decoded only when read: summaries and matching use the
            # original estimate or a stored recalculation, and it is one of a row's largest values.
            for row in s.scalars(
                select(h)
                .options(defer(h.estimate))
                .where(h.tenant == tenant, h.owner == owner, h.message_key.in_(chunk))
            ):
                rows[(row.tenant, row.owner, row.message_key)] = row
    # A row erased between the two reads is left out, as a read a moment later would.
    return [rows[key] for key in keys if key in rows]


def metric_groups(s, row, method_id):
    """A saved message's resource metrics in the chosen view, each with its summary group."""
    from .engine_adapter import history_metrics
    from .engine_history import selected_history

    selected = selected_history(s, row, method_id)
    return [
        (
            metric,
            (
                metric["quantity"],
                metric["unit"],
                metric["method_hash"],
                metric["selected_profile_id"],
                metric["status"],
                canonical_json(metric["reasons"]),
                canonical_json(metric["missing_components"]),
                canonical_json(metric.get("comparability")),
                canonical_json(metric.get("effective_method")),
                metric.get("interval_kind"),
            ),
        )
        for metric in (history_metrics(selected, row.payload) if row.role == "response" else [])
    ]


def scope_conditions(company, marker):
    conditions = [HistoryObservation.tenant == company.id]
    if marker.get("user_id"):
        conditions.append(HistoryObservation.owner == marker["user_id"])
    if marker["scope"] not in ("user", "company"):
        conditions.append(
            or_(
                HistoryObservation.occurred_at.is_(None),
                and_(
                    HistoryObservation.occurred_at >= indexed_instant(marker["start"]),
                    HistoryObservation.occurred_at < indexed_instant(marker["end"]),
                ),
            )
        )
    return conditions


class PeriodRows:
    """
    The saved messages of one period, in summary() order (owner, then message key), read once in
    a read memo. select() returns what summary()'s query and attributed() return for a period
    inside it with a tool or model filter: each filter is the SQL condition written in Python, and
    a filtered list keeps the order of the full one.
    """

    def __init__(self, usage, s, company, bounds, rows):
        self.usage, self.s, self.company, self.bounds, self.rows = usage, s, company, bounds, rows
        self._regenerated = self._first = self._reply_models = self._plain = None

    def covers(self, bounds):
        return self.bounds is None or (
            bounds is not None and self.bounds[0] <= bounds[0] and bounds[1] <= self.bounds[1]
        )

    def select(self, bounds, site, model):
        rows = self.rows
        if bounds != self.bounds or site:
            if self._plain is None:
                # Each split filters every row again; plain values are much faster to read than
                # the rows' mapped attributes.
                self._plain = [(r.occurred_at, r.site, r) for r in self.rows]
            dated = bounds != self.bounds
            # As occurred_at >= start AND occurred_at < end: an undated row is in no period. Both
            # sides are indexed_instant strings of one width, so text order is time order.
            rows = [
                r
                for at, where, r in self._plain
                if (not dated or (at is not None and bounds[0] <= at < bounds[1]))
                and (not site or where == site)
            ]
        if model:
            rows = [r for r in rows if self._named(r, model)]
            rows = self.usage.attributed(self.s, self.company, rows, model, self._first_models())
        return rows

    def regenerated(self):
        # regenerated_history_replies groups a person's replies by chat and prompt, and every chat
        # of a selected reply is read whole, so the answer for a reply is the same from any
        # selection that holds it.
        if self._regenerated is None:
            self._regenerated = self.usage.regenerated(self.s, self.company, self.rows)
        return self._regenerated

    def _named(self, row, model):
        """summary()'s model condition: the row names the model, or it is a prompt that names
        none and one of its saved replies (any, as the query's EXISTS reads them) names it."""
        model_id = row.payload.get("model_id")
        if model == "unknown":
            return model_id is None
        if model_id == model:
            return True
        return (
            row.role == "prompt"
            and model_id is None
            and model in self._models_of_replies().get((row.owner, row.message_key), ())
        )

    def _models_of_replies(self):
        if self._reply_models is None:
            h = HistoryObservation
            unnamed = [r for r in self.rows if r.role == "prompt" and r.payload.get("model_id") is None]
            owners = sorted({r.owner for r in unnamed})
            keys = sorted({r.message_key for r in unnamed})
            prompt_key, model_id = h.payload["prompt_key"].as_string(), h.payload["model_id"].as_string()
            # The prompt a reply answers (answered_prompt): its prompt_key, else its parent_key.
            answered = func.coalesce(prompt_key, h.payload["parent_key"].as_string())
            found = {}
            for start in range(0, len(keys), 500):
                for owner, key, model in self.s.execute(
                    select(h.owner, answered, model_id).where(
                        h.tenant == self.company.id,
                        h.owner.in_(owners),
                        h.role == "response",
                        answered_prompt_in(keys[start : start + 500]),
                    )
                ):
                    if model is not None:
                        found.setdefault((owner, key), set()).add(model)
            self._reply_models = found
        return self._reply_models

    def _first_models(self):
        if self._first is None:
            unnamed = [r for r in self.rows if r.role == "prompt" and r.payload["model_id"] is None]
            self._first = self.usage.first_reply_models(self.s, self.company, unnamed) if unnamed else {}
        return self._first


class HistoricalUsage:
    def __init__(self, analytics):
        self.analytics = analytics

    def visible(self, company):
        return self._visible()

    @staticmethod
    @lru_cache(maxsize=1)
    def _visible():
        # The condition names no organization, so one expression serves every query; a summary
        # with its splits builds it more than a hundred times otherwise.
        h = HistoryObservation
        stable = exists(
            select(1).where(
                DeletionTombstone.tenant == h.tenant,
                DeletionTombstone.owner == h.owner,
                DeletionTombstone.reason != "retention",
                or_(
                    and_(
                        DeletionTombstone.kind == "request",
                        DeletionTombstone.stable_key == h.payload["provider_request_key"].as_string(),
                    ),
                    and_(
                        DeletionTombstone.kind == "attempt",
                        DeletionTombstone.stable_key == h.payload["provider_attempt_key"].as_string(),
                    ),
                ),
            )
        )
        erased = exists(
            select(1).where(
                DeletionScope.tenant == h.tenant,
                or_(DeletionScope.deletion_user_id.is_(None), DeletionScope.deletion_user_id == h.owner),
                DeletionScope.data["retention"].as_boolean().is_not(True),
                or_(
                    DeletionScope.scope.in_(("user", "company")),
                    h.occurred_at.is_(None),
                    and_(
                        func.substr(DeletionScope.range_start, 1, 23).op("||")("000Z") <= h.occurred_at,
                        func.substr(DeletionScope.range_end, 1, 23).op("||")("000Z") > h.occurred_at,
                    ),
                ),
            )
        )
        tombstone = exists(
            select(1).where(
                HistoryTombstone.tenant == h.tenant,
                HistoryTombstone.owner == h.owner,
                HistoryTombstone.message_key == h.message_key,
            )
        )
        return and_(~stable, ~erased, ~tombstone)

    def regenerated(self, s, company, rows):
        """(owner, message_key) of the saved Claude replies among rows that regenerated an
        earlier reply (regenerated_history_replies). As in the extension, the earlier reply is
        looked for among every stored row of the chat, whatever the summary's filters."""
        candidates = [r for r in rows if r.role == "response" and r.site == "claude"]
        if not candidates:
            return set()
        owners = {r.owner for r in candidates}
        conversations = sorted({r.conversation for r in candidates})
        records = {}
        for start in range(0, len(conversations), 500):
            for row in load_rows(
                s,
                [
                    HistoryObservation.tenant == company.id,
                    HistoryObservation.owner.in_(owners),
                    HistoryObservation.conversation.in_(conversations[start : start + 500]),
                    HistoryObservation.role == "response",
                    HistoryObservation.site == "claude",
                ],
            ):
                records.setdefault(row.owner, []).append(row.payload)
        return {
            (owner, key) for owner, payloads in records.items() for key in regenerated_history_replies(payloads)
        }

    def period(self, s, company, owner, bounds):
        """
        The saved messages of a summary over a period, without its tool and model filters, as
        PeriodRows; or None, and the summary reads its rows with SQL. A dashboard summary's day,
        tool and model splits all lie within the summary's own period, so inside one read memo
        the period is read once and every split takes its rows from it. Outside a memo, and for
        a period over the row limit, there is nothing to share.
        """
        from .history_matching import remembered, remembering, seed_visible_rows

        if not remembering(s):
            return None
        periods = remembered(s, ("periods", company.id, owner), list)
        for period in periods:
            if period.rows is not None and period.covers(bounds):
                return period
        if any(period.bounds == bounds for period in periods):
            return None
        h = HistoryObservation
        # The conditions of summary() for a period, without its tool and model conditions.
        conditions = [h.tenant == company.id, self.visible(company), h.company_shared.is_(False)]
        if owner:
            conditions.append(h.owner == owner)
        if bounds:
            conditions.extend([h.occurred_at >= bounds[0], h.occurred_at < bounds[1]])
        rows = load_rows(s, conditions, (h.owner, h.message_key), limit=10001)
        period = PeriodRows(self, s, company, bounds, rows if len(rows) <= 10000 else None)
        periods.append(period)
        if period.rows is None:
            return None
        seed_visible_rows(s, rows)
        return period

    def attributed(self, s, company, rows, model, first=None):
        """The rows of a model's summary ("unknown" for none), with each prompt that names no
        model counted for the model of its first visible reply (reply_models). Saved prompts
        often name no model while their replies do; left out, a model's saved replies had no
        request and its figures per request were inflated (admin site, 14 October 2026).
        first, when given, is first_reply_models of these rows or of more rows: each prompt's
        answer depends only on its own replies."""
        unnamed = [r for r in rows if r.role == "prompt" and r.payload["model_id"] is None]
        if not unnamed:
            return rows
        if first is None:
            first = self.first_reply_models(s, company, unnamed)
        wanted = None if model == "unknown" else model
        return [
            r
            for r in rows
            if not (r.role == "prompt" and r.payload["model_id"] is None)
            or first.get(r.owner, {}).get(r.message_key) == wanted
        ]

    def first_reply_models(self, s, company, unnamed):
        """Per owner, reply_models of the visible replies to the saved prompts unnamed."""
        owners = {r.owner for r in unnamed}
        keys = sorted({r.message_key for r in unnamed})
        replies = {}
        for start in range(0, len(keys), 500):
            for row in load_rows(
                s,
                [
                    HistoryObservation.tenant == company.id,
                    HistoryObservation.owner.in_(owners),
                    HistoryObservation.role == "response",
                    answered_prompt_in(keys[start : start + 500]),
                    self.visible(company),
                ],
            ):
                replies.setdefault(row.owner, []).append(row.payload)
        return {owner: reply_models(payloads) for owner, payloads in replies.items()}

    def erased(self, s, company, owner, m):
        if s.get(HistoryTombstone, (company.id, owner, m["message_key"])):
            return True
        for marker in s.scalars(
            select(DeletionScope).where(
                DeletionScope.tenant == company.id,
                or_(DeletionScope.deletion_user_id.is_(None), DeletionScope.deletion_user_id == owner),
            )
        ):
            if marker.data.get("retention"):
                continue
            if (
                marker.scope in ("user", "company")
                or m["occurred_at"] is None
                or parse_time(marker.range_start)
                <= parse_time(m["occurred_at"])
                < parse_time(marker.range_end)
            ):
                return True
        for field, kind in (("provider_request_key", "request"), ("provider_attempt_key", "attempt")):
            if m[field] and s.scalar(
                select(DeletionTombstone.record_id)
                .where(
                    DeletionTombstone.tenant == company.id,
                    DeletionTombstone.owner == owner,
                    DeletionTombstone.kind == kind,
                    DeletionTombstone.reason != "retention",
                    DeletionTombstone.stable_key == m[field],
                )
                .limit(1)
            ):
                return True
        return False

    def ingest(self, s, company, member, device, body, query):
        if not device:
            raise Problem("installation_required", 403)
        if query:
            raise Problem("unsupported_filter", 422)
        page = validate_page(body)
        if page["deletion_epoch"] != company.data["epoch"]:
            raise Problem("deletion_epoch_changed", 409, True)
        # Company keys travel beside the messages, one per message at most (W11).
        keys = self.analytics.company.key_entries(
            company,
            page.get("company_dedup_keys"),
            {m["message_key"] for m in page["messages"]},
            lambda entry: entry["message_key"],
            error="payload_rejected",
        )
        elections = set()
        if self.analytics.deletions.in_progress(s, company):
            raise Problem("deletion_in_progress", 409, True)
        now = self.analytics.service.now()
        eras = list(
            s.scalars(
                select(EnrollmentEra).where(
                    EnrollmentEra.tenant == company.id, EnrollmentEra.device_id == device.id
                )
            )
        )
        results = []
        for m in page["messages"]:
            receipt_hash = numeric_payload_hash(m)
            observed = parse_time(m["observed_at"])
            if observed > now + timedelta(minutes=5):
                raise Problem("clock_skew", 422)
            if not any(
                e.data["start"] <= m["observed_at"]
                and (e.data["end"] is None or m["observed_at"] < e.data["end"])
                for e in eras
            ):
                raise Problem("outside_enrollment_era", 409)
            from .method_registry import estimate_history, retain_packaged_definition
            from .timing_evidence import merge_history_evidence

            key = (company.id, member.id, m["message_key"])
            old = s.get(HistoryObservation, key)
            if old:
                # The proposed method names the estimation release of the browser that read the
                # message, not the message: another installation of the member, a reinstall or a
                # re-import after a release proposes another one. The stored copy keeps its first
                # method, as the extension keeps it locally (history-service.ts). Until 15 October
                # 2026 such a copy was a conflict and took the message out of every total.
                m = {
                    **m,
                    "proposed_method_id": old.payload["proposed_method_id"],
                    "proposed_method_hash": old.payload["proposed_method_hash"],
                }
                m = merge_history_evidence(old.payload, m)
            retain_packaged_definition(s, m["proposed_method_id"], now)
            try:
                assessment = estimate_history(s, m)
            except Problem as error:
                if error.code not in {"method_unsupported", "engine_unavailable"}:
                    raise
                assessment = {"status": "pending", "reason": error.code}
            hashed = numeric_payload_hash(m)
            if self.erased(s, company, member.id, m):
                results.append(
                    {"message_key": m["message_key"], "payload_hash": receipt_hash, "status": "erased"}
                )
                continue
            action = refine(old.payload, m) if old else "improved"
            key = keys.get(m["message_key"])
            # A company key names the message itself, so a different one is a conflict (W11).
            if key and old and old.company_key and old.company_key != key:
                action = "conflict"
            # The server keeps no copy of the read that contradicted a stored one. A copy the rules
            # accept from an installation other than the one that stored the message shows that the
            # member's reads agree again; the storing installation agreeing with itself shows
            # nothing. This also clears the conflicts the proposed method raised before 15 October.
            cleared = bool(
                old and old.status == "conflict" and action != "conflict" and old.device != device.id
            )
            if action != "duplicate" or cleared:
                from types import SimpleNamespace

                from .engine_history import invalidate_linked_estimates

                if old:
                    invalidate_linked_estimates(s, old)
                invalidate_linked_estimates(s, SimpleNamespace(tenant=company.id, owner=member.id, payload=m))
            row = old
            if cleared:
                old.status = "current"
            if action == "improved":
                if old:
                    old.payload = m
                    old.payload_hash = hashed
                    old.occurred_at = indexed_instant(m["occurred_at"])
                    old.estimate = assessment
                else:
                    row = HistoryObservation(
                        tenant=company.id,
                        owner=member.id,
                        message_key=m["message_key"],
                        device=device.id,
                        conversation=m["conversation_key"],
                        role=m["role"],
                        site=m["site"],
                        occurred_at=indexed_instant(m["occurred_at"]),
                        observed_at=m["observed_at"],
                        payload=m,
                        original=m,
                        payload_hash=hashed,
                        estimate=assessment,
                        original_estimate=assessment,
                        status="current",
                    )
                    s.add(row)
            elif action == "conflict":
                old.status = "conflict"
            # A key that arrives with a later upload of an unchanged message still applies.
            if key and row.company_key is None:
                row.company_key = key
            if row.company_key:
                elections.add(row.company_key)
            results.append(
                {
                    "message_key": m["message_key"],
                    "payload_hash": receipt_hash,
                    # A message that stays a conflict is reported as one, so the browser excludes
                    # it as the server does and clears it only once the server counts it again.
                    "status": "conflict"
                    if row.status == "conflict"
                    else ("applied" if action == "improved" else action),
                }
            )
        for key in sorted(elections):
            self.analytics.company.elect(s, company, key)
        # An accepted upload of saved messages is a sync like a usage batch. Without this, a browser
        # that had only sent saved history showed "Never" synced on the Health page (14 Oct 2026).
        if any(result["status"] != "conflict" for result in results):
            device.data = {**device.data, "last_reporting_at": instant(now)}
        retained = s.scalar(
            select(HistoryObservation.message_key)
            .where(
                HistoryObservation.tenant == company.id,
                HistoryObservation.owner == member.id,
                HistoryObservation.conversation == page["conversation_key"],
                self.visible(company),
            )
            .limit(1)
        )
        if retained is None:
            return {"schema_version": "3.0.0", "deletion_epoch": company.data["epoch"], "results": results}
        metadata = {k: v for k, v in page.items() if k != "messages"}
        coverage = s.get(HistoryCoverage, (company.id, member.id, page["conversation_key"]))
        if coverage and coverage.payload["observed_at"] <= metadata["observed_at"]:
            root = metadata["root_message_key"] or coverage.payload["root_message_key"]
            metadata = {
                **metadata,
                "root_message_key": root,
                "first_request_verified": metadata["first_request_verified"]
                or (
                    coverage.payload["first_request_verified"]
                    and coverage.payload["root_message_key"] == root
                ),
            }
            coverage.payload = metadata
        elif not coverage:
            s.add(
                HistoryCoverage(
                    tenant=company.id,
                    owner=member.id,
                    conversation=page["conversation_key"],
                    payload=metadata,
                )
            )
        s.flush()
        return {"schema_version": "3.0.0", "deletion_epoch": company.data["epoch"], "results": results}

    def summary(self, s, company, owner, conversation=None, query=None, requests_only=False, since=None):
        """
        The saved-history part of a summary. With requests_only the message counts are exact and
        the token, resource and document figures are left empty: the People page needs only how
        many requests each person's saved messages add. since (one person's figures for an
        administrator, see Analytics.person_floor) leaves out messages from before that instant.
        """
        if self.analytics.deletions.in_progress(s, company):
            raise Problem("deletion_in_progress", 409, True)
        conditions = [HistoryObservation.tenant == company.id, self.visible(company)]
        if owner:
            conditions.append(HistoryObservation.owner == owner)
        if conversation:
            if not re.fullmatch("[a-f0-9]{64}", conversation):
                raise Problem("payload_rejected", 422)
            conditions.append(HistoryObservation.conversation == conversation)
        else:
            # A message another member's copy counts stays in conversation views only (W11).
            conditions.append(HistoryObservation.company_shared.is_(False))
        query = query or {}
        bounds = None
        if query.get("period", "all") != "all" or "start" in query:
            start, end = self.analytics.bounds(
                company, {k: v for k, v in query.items() if k in {"period", "start", "end", "site", "model"}}
            )
            bounds = (indexed_instant(start), indexed_instant(end))
            if not conversation:
                conditions.extend(
                    [HistoryObservation.occurred_at >= bounds[0], HistoryObservation.occurred_at < bounds[1]]
                )
        if since:
            conditions.append(recorded_since(since))
        if query.get("model"):
            model = query["model"]
            h = HistoryObservation
            reply = aliased(HistoryObservation)
            # A prompt that names no model counts for the model of its first reply (reply_models).
            # The query takes every prompt one of whose replies names the model; attributed()
            # then keeps those whose first visible reply does.
            answered = and_(
                h.role == "prompt",
                h.payload["model_id"].as_string().is_(None),
                exists(
                    select(1).where(
                        reply.tenant == h.tenant,
                        reply.owner == h.owner,
                        reply.role == "response",
                        # The prompt the reply answers (answered_prompt).
                        or_(
                            reply.payload["prompt_key"].as_string() == h.message_key,
                            and_(
                                reply.payload["prompt_key"].as_string().is_(None),
                                reply.payload["parent_key"].as_string() == h.message_key,
                            ),
                        ),
                        reply.payload["model_id"].as_string() == model,
                    )
                ),
            )
            conditions.append(
                h.payload["model_id"].as_string().is_(None)
                if model == "unknown"
                else or_(h.payload["model_id"].as_string() == model, answered)
            )
        if query.get("site"):
            conditions.append(HistoryObservation.site == query["site"])
        from .history_matching import prefetch, remembered, seed_visible_rows

        result = empty_summary()
        # The shared period rows know nothing of since, so such a summary reads its own rows.
        period = None if conversation or since else self.period(s, company, owner, bounds)
        if period:
            rows = period.select(bounds, query.get("site"), query.get("model"))
            regenerated = period.regenerated()
        else:
            rows = load_rows(
                s, conditions, (HistoryObservation.owner, HistoryObservation.message_key), limit=10001
            )
            if len(rows) > 10000:
                result["status"] = "unavailable"
                return result
            if query.get("model"):
                rows = self.attributed(s, company, rows, query["model"])
            seed_visible_rows(s, rows)
            regenerated = self.regenerated(s, company, rows)
        coverage = (
            s.get(HistoryCoverage, (company.id, owner, conversation)) if conversation and owner else None
        )
        if (
            coverage
            and coverage.payload["branch_scope"] == "selected_branch"
            and coverage.payload["selected_leaf_key"]
        ):
            by_key = {r.message_key: r for r in rows}
            keys = set()
            cursor = coverage.payload["selected_leaf_key"]
            while cursor in by_key and cursor not in keys:
                keys.add(cursor)
                cursor = by_key[cursor].payload["parent_key"]
            rows = [r for r in rows if r.message_key in keys]
            result["branch_scope"] = "selected_branch"
            result["first_request_verified"] = bool(
                coverage.payload["first_request_verified"]
                and cursor is None
                and coverage.payload["root_message_key"] in keys
                and all(r.status == "current" for r in rows)
            )
        elif coverage:
            result["branch_scope"] = coverage.payload["branch_scope"]
            result["first_request_verified"] = bool(
                coverage.payload["first_request_verified"]
                and any(
                    r.message_key == coverage.payload["root_message_key"]
                    and r.role == "prompt"
                    and r.status == "current"
                    for r in rows
                )
            )
        if conversation and bounds:
            rows = [r for r in rows if r.occurred_at is not None and bounds[0] <= r.occurred_at < bounds[1]]
        # Conflicting rows are never matched; prefetch skips them and rows already resolved.
        prefetch(s, rows)
        if query.get("calculation_view") == "recalculated" and not requests_only:
            from .engine_history import prefetch_estimates

            # Prompts are looked up too: metric_groups reads a prompt's estimate before it finds
            # that a prompt has no metrics.
            prefetch_estimates(s, rows, query.get("method_id"), "recalculated")
        tokens = {}
        resources = {}
        files = {}
        from .engine_adapter import packaged_claude_token_factor
        from .history_matching import resolve_history_live

        claude_factor = packaged_claude_token_factor()

        def add(key):
            result[key] = str(int(result[key]) + 1)

        # With requests_only, prompt_count per person: each person's own summary counts the same
        # rows, as long as the period holds no more saved messages than one summary reads.
        requests_by_owner = {}

        for row in rows:
            m = row.payload if query.get("calculation_view") == "recalculated" else row.original
            result["status"] = "available"
            add("observed_prompt_count" if row.role == "prompt" else "observed_response_count")
            add("dated_message_count" if m["occurred_at"] else "undated_message_count")
            if row.status == "conflict":
                add("conflicting_message_count")
            else:
                overlap = resolve_history_live(s, row) is not None
                if overlap:
                    add("matched_live_message_count")
                elif "no_live_request" not in m["coverage_reasons"]:
                    # A row no live capture can produce never waits for a live match (W9).
                    add("unresolved_overlap_message_count")
                if overlap:
                    continue
                add("prompt_count" if row.role == "prompt" else "response_count")
                # A regeneration no live capture matched is a request of its own (Req).
                regeneration = row.role == "response" and (row.owner, row.message_key) in regenerated
                if regeneration:
                    add("prompt_count")
                if requests_only:
                    if row.role == "prompt" or regeneration:
                        requests_by_owner[row.owner] = requests_by_owner.get(row.owner, 0) + 1
                    continue
                known = m["tokens"]["value"] is not None
                add("calculated_message_count" if known else "uncalculated_message_count")
                token_parts, file_components = remembered(
                    s,
                    ("message parts", row.tenant, row.owner, row.message_key, m is row.payload),
                    lambda: message_parts(m, claude_factor),
                )
                for part, measured in token_parts:
                    group = (row.role, part, measured["profile_id"], measured["evidence"])
                    t = tokens.setdefault(
                        group,
                        {
                            "role": row.role,
                            "part": part,
                            "profile_id": group[2],
                            "evidence": group[3],
                            "value": None,
                            "known_message_count": "0",
                            "unknown_message_count": "0",
                        },
                    )
                    field = (
                        "known_message_count" if measured["value"] is not None else "unknown_message_count"
                    )
                    t[field] = str(int(t[field]) + 1)
                    if measured["value"] is not None:
                        t["value"] = str(int(t["value"] or "0") + int(measured["value"]))
                field = (
                    "observed_message_count" if m["inline_file_text"] is not None else "unknown_message_count"
                )
                result["file_text_coverage"][field] = str(int(result["file_text_coverage"][field]) + 1)
                for file_key, addition in file_components:
                    target = files.setdefault(
                        file_key,
                        {
                            **addition,
                            "value": Decimal(0),
                            **{
                                k: 0
                                for k in (
                                    "applicable_count",
                                    "unknown_count",
                                    "partial_count",
                                    "unvalidated_count",
                                    "contributing_component_count",
                                )
                            },
                            "reason_counts": {},
                            "missing_counts": {},
                        },
                    )
                    target["value"] += addition["value"]
                    for field in (
                        "applicable_count",
                        "unknown_count",
                        "partial_count",
                        "unvalidated_count",
                        "contributing_component_count",
                    ):
                        target[field] += addition[field]
                    for field in ("reason_counts", "missing_counts"):
                        for reason, n in addition[field].items():
                            target[field][reason] = target[field].get(reason, 0) + n
                method_id = query.get("method_id") if query.get("calculation_view") == "recalculated" else None
                for metric, group in remembered(
                    s,
                    ("metrics", row.tenant, row.owner, row.message_key, method_id),
                    lambda: metric_groups(s, row, method_id),
                ):
                    created = group not in resources
                    r = resources.setdefault(
                        group,
                        {**metric, "value": None, "known_message_count": "0", "unknown_message_count": "0"},
                    )
                    ranged = "requested_method" in metric and metric["interval_kind"] is not None
                    if "requested_method" in metric:
                        result["schema_version"] = "3.0.0"
                        if created and ranged:
                            # Scenario sums add the same endpoint of every ranged record. The group
                            # itself carries no joint interval kind.
                            r.update(
                                scenario_low=None,
                                scenario_high=None,
                                interval_kind=None,
                                value_kind="midpoint_sum",
                            )
                    field = "known_message_count" if metric["value"] is not None else "unknown_message_count"
                    r[field] = str(int(r[field]) + 1)
                    if metric["value"] is not None:
                        if "requested_method" in metric:
                            with localcontext() as context:
                                context.prec = 90
                                amount = Decimal(r["value"] or "0") + Decimal(metric["value"])
                                r["value"] = str(amount).lower()
                                if ranged:
                                    for endpoint in ("scenario_low", "scenario_high"):
                                        total = Decimal(r[endpoint] or "0") + Decimal(metric[endpoint])
                                        r[endpoint] = str(total).lower()
                        else:
                            amount = Decimal(r["value"] or "0") + Decimal(metric["value"])
                            r["value"] = quantity_string(amount)
        result["tokens"] = list(tokens.values())
        result["resources"] = list(resources.values())
        result["file_text"] = [
            {**row, "value": quantity_string(row["value"]) if row["contributing_component_count"] else None}
            for row in files.values()
        ]
        if requests_only:
            result["prompt_count_by_owner"] = requests_by_owner
        return result

    def erase_page(self, s, company, marker, limit=100):
        if marker.get("retention"):
            return 0
        conditions = scope_conditions(company, marker)
        if marker["scope"] not in ("user", "company"):
            conditions[-1] = or_(conditions[-1], ~self.visible(company))
        rows = list(
            s.scalars(
                select(HistoryObservation)
                .where(*conditions)
                .order_by(HistoryObservation.owner, HistoryObservation.message_key)
                .limit(limit)
            )
        )
        elections = set()
        for row in rows:
            from .engine_history import erase

            if erase(s, row, limit):
                # Drain bounded overlay pages before removing their source identity.
                s.flush()
                for key in sorted(elections):
                    self.analytics.company.elect(s, company, key)
                return 1
            if row.company_key:
                elections.add(row.company_key)
            if not s.get(HistoryTombstone, (company.id, row.owner, row.message_key)):
                s.add(
                    HistoryTombstone(
                        tenant=company.id, owner=row.owner, message_key=row.message_key, epoch=marker["epoch"]
                    )
                )
            c = s.get(HistoryCoverage, (company.id, row.owner, row.conversation))
            if c:
                s.delete(c)
            s.delete(row)
        s.flush()
        # Another member's copy of an erased message counts from now on (erase handover).
        for key in sorted(elections):
            self.analytics.company.elect(s, company, key)
        return len(rows)

    def export_page(self, s, company, member, device, query):
        if not device:
            raise Problem("installation_required", 403)
        if set(query) - {"cursor", "conversation_key", "calculation_view", "method_id"}:
            raise Problem("unsupported_filter", 422)
        cursor = query.get("cursor", "")
        conversation = query.get("conversation_key")
        if (cursor and not re.fullmatch("[a-f0-9]{64}", cursor)) or (
            conversation and not re.fullmatch("[a-f0-9]{64}", conversation)
        ):
            raise Problem("payload_rejected", 422)
        if self.analytics.deletions.in_progress(s, company):
            raise Problem("deletion_in_progress", 409, True)
        calculation = self.analytics.methods.prepare_view(s, company, member, query, personal=True)
        where = [
            HistoryObservation.tenant == company.id,
            self.visible(company),
            HistoryObservation.owner == member.id,
            HistoryObservation.message_key > cursor,
        ]
        if conversation:
            where.append(HistoryObservation.conversation == conversation)
        rows = list(
            s.scalars(
                select(HistoryObservation).where(*where).order_by(HistoryObservation.message_key).limit(101)
            )
        )
        selected = rows[:100]
        from .engine_history import selected_history

        return {
            "schema_version": "3.0.0",
            "scope": "loaded_history",
            "deletion_epoch": company.data["epoch"],
            "records": [
                {
                    "observation": r.payload,
                    "original": r.original,
                    "numeric_payload_hash": r.payload_hash,
                    "status": r.status,
                    "resources": selected_history(s, r, calculation.get("method_id")),
                    "original_resources": r.original_estimate,
                }
                for r in selected
                if not self.erased(s, company, member.id, r.payload)
            ],
            "next_cursor": selected[-1].message_key if len(rows) > 100 else None,
        }

    def verify_record(self, s, company, row):
        m = row.payload
        validate_page(
            {
                "schema_version": "3.0.0",
                "site": m["site"],
                "conversation_key": m["conversation_key"],
                "observed_at": m["observed_at"],
                "deletion_epoch": company.data["epoch"],
                "messages": [m],
                "branch_scope": "unknown",
                "selected_leaf_key": None,
                "branch_message_keys": None,
                "root_message_key": None,
                "first_request_verified": False,
                "has_earlier": None,
                "has_later": None,
            }
        )
        from .method_registry import estimate_history

        for record, assessment in ((m, row.estimate), (row.original, row.original_estimate)):
            if isinstance(assessment, dict) and assessment.get("status") == "pending":
                continue
            if canonical_json(estimate_history(s, record)) != canonical_json(assessment):
                raise Problem("aggregate_inconsistent", 503)
        if (
            row.payload_hash != numeric_payload_hash(m)
            or row.message_key != m["message_key"]
            or row.conversation != m["conversation_key"]
            or row.occurred_at != indexed_instant(m["occurred_at"])
            or self.erased(s, company, row.owner, m)
        ):
            raise Problem("aggregate_inconsistent", 503)

    def remaining(self, s, company, marker):
        if marker.get("retention"):
            return False
        conditions = scope_conditions(company, marker)
        if marker["scope"] not in ("user", "company"):
            conditions[-1] = or_(conditions[-1], ~self.visible(company))
        return s.scalar(select(HistoryObservation.message_key).where(*conditions).limit(1)) is not None
